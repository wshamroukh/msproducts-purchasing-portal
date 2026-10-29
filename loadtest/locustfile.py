"""
Load test for the Microsoft Products Purchasing Portal (Locust - runs in Azure Load Testing or locally).

Every virtual user behaves like an employee:
  1. "Signs in"  - gets an Entra ID access token (client credentials of the load-test app)
  2. Opens the portal - index.html, JS/CSS bundles and /config.json (the SPA)
  3. Browses       - /api/me, catalog, product pages
  4. Checks out    - POST /api/orders (the cart itself lives in the browser, so checkout is the server call)
  5. Tracks orders - my orders + order details, and cancels the order again so stock is returned

All traffic goes to the PUBLIC portal URL; the portal forwards /api/* to the private API.

Environment variables (set by setup-loadtest.sh in Azure Load Testing):
  LOCUST_HOST               portal URL, e.g. https://app-msstore-portal-xxxxx.azurewebsites.net
  TENANT_ID                 Entra tenant id
  LOADTEST_CLIENT_ID        app id of the load-test app registration
  LOADTEST_CLIENT_SECRET    its client secret (a Key Vault secret in Azure Load Testing)
  API_SCOPE                 api://<api-app-id>/.default
  CANCEL_RATIO              share of placed orders that are cancelled again (default 1.0)
  ORDER_WEIGHT              relative weight of the checkout task (default 1)
"""
import os
import random
import re
import threading
import time
import uuid

from locust import HttpUser, between, events, task

TENANT_ID = os.environ.get("TENANT_ID", "")
CLIENT_ID = os.environ.get("LOADTEST_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("LOADTEST_CLIENT_SECRET", "")
API_SCOPE = os.environ.get("API_SCOPE", "")
CANCEL_RATIO = float(os.environ.get("CANCEL_RATIO", "1.0"))
ORDER_WEIGHT = int(os.environ.get("ORDER_WEIGHT", "1"))
ENGINE = os.environ.get("ALT_ENGINE_ID", uuid.uuid4().hex[:6])  # unique per test engine

ASSET_RE = re.compile(r'(?:src|href)="(/assets/[^"]+)"')


@events.test_start.add_listener
def check_config(environment, **_):
    missing = [n for n, v in {"TENANT_ID": TENANT_ID, "LOADTEST_CLIENT_ID": CLIENT_ID,
                              "LOADTEST_CLIENT_SECRET": CLIENT_SECRET, "API_SCOPE": API_SCOPE}.items() if not v]
    if missing:
        raise RuntimeError(f"Missing environment variables: {', '.join(missing)}")


class Token:
    """One app-only access token per engine process, refreshed 5 minutes before it expires."""
    _lock = threading.Lock()
    value = None
    expires = 0.0

    @classmethod
    def get(cls, user):
        if cls.value and time.time() < cls.expires - 300:
            return cls.value
        with cls._lock:
            if cls.value and time.time() < cls.expires - 300:
                return cls.value
            with user.client.post(
                f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
                data={"grant_type": "client_credentials", "client_id": CLIENT_ID,
                      "client_secret": CLIENT_SECRET, "scope": API_SCOPE},
                name="1. Entra ID: get access token",
                catch_response=True,
            ) as r:
                if r.status_code != 200:
                    r.failure(f"token request failed: {r.status_code} {r.text[:200]}")
                    return None
                body = r.json()
                cls.value = body["access_token"]
                cls.expires = time.time() + int(body.get("expires_in", 3600))
                return cls.value


class Shopper(HttpUser):
    wait_time = between(2, 6)  # think time between actions

    def on_start(self):
        self.user_id = f"{ENGINE}-{uuid.uuid4().hex[:10]}"
        self.products = []
        self.my_orders = []
        self.open_portal()
        self.sign_in()

    # ---------- helpers ----------
    def api_headers(self):
        token = Token.get(self)
        return {"Authorization": f"Bearer {token}", "x-loadtest-user": self.user_id} if token else None

    def api(self, method, path, name, **kwargs):
        headers = self.api_headers()
        if not headers:
            return None
        with self.client.request(method, path, headers=headers, name=name, catch_response=True, **kwargs) as r:
            if r.status_code >= 400:
                r.failure(f"{r.status_code}: {r.text[:200]}")
                return None
            try:
                return r.json()
            except ValueError:
                r.failure("response is not JSON (is the portal proxying /api to the API?)")
                return None

    # ---------- journey ----------
    def open_portal(self):
        """What the browser downloads when an employee opens the portal."""
        r = self.client.get("/", name="2. Portal: index.html")
        for asset in set(ASSET_RE.findall(r.text or "")):
            self.client.get(asset, name="2. Portal: JS/CSS bundle")
        self.client.get("/config.json", name="2. Portal: config.json")

    def sign_in(self):
        """After MSAL sign-in the SPA calls /api/me with the access token."""
        self.api("GET", "/api/me", "3. API: /api/me (signed-in user)")
        self.load_catalog()

    def load_catalog(self):
        data = self.api("GET", "/api/products", "4. API: catalog")
        if data:
            self.products = data

    @task(3)
    def browse(self):
        self.open_portal()
        self.load_catalog()

    @task(4)
    def view_product(self):
        if not self.products:
            return self.load_catalog()
        p = random.choice(self.products)
        self.api("GET", f"/api/products/{p['ProductId']}", "5. API: product details")

    @task(ORDER_WEIGHT)
    def checkout(self):
        # Prefer products with plenty of stock so the test does not sell out the catalog
        candidates = [p for p in self.products if p.get("Stock", 0) >= 1000] or self.products
        if not candidates:
            return self.load_catalog()
        items = [{"productId": p["ProductId"], "quantity": 1}
                 for p in random.sample(candidates, k=min(len(candidates), random.randint(1, 3)))]
        order = self.api("POST", "/api/orders", "6. API: checkout (place order)", json={
            "items": items,
            "shipping": {"name": f"Load Test {self.user_id}", "address": "Load test street 1",
                         "city": "Muscat", "country": "Oman", "phone": "+968 0000 0000"},
            "costCenter": "LOADTEST",
            "justification": "Azure Load Testing run",
        })
        if not order:
            return
        self.api("GET", f"/api/orders/{order['orderId']}", "7. API: order confirmation")
        if random.random() < CANCEL_RATIO:
            self.api("POST", f"/api/orders/{order['orderId']}/cancel", "8. API: cancel order")
        else:
            self.my_orders.append(order["orderId"])

    @task(2)
    def my_orders_page(self):
        orders = self.api("GET", "/api/orders", "9. API: my orders")
        if orders:
            o = random.choice(orders)
            self.api("GET", f"/api/orders/{o['OrderId']}", "7. API: order details")
