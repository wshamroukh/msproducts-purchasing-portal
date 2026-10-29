# Load testing the purchasing portal (Azure Load Testing + Locust)

## What one virtual user does

| Step | Request | Why |
|---|---|---|
| 1 | `POST login.microsoftonline.com/.../token` | Gets an Entra ID access token (client credentials of the load-test app; cached and refreshed per engine) |
| 2 | `GET /`, JS/CSS bundles, `/config.json` | What the browser downloads when the portal opens |
| 3 | `GET /api/me` | First call the SPA makes after sign-in |
| 4 | `GET /api/products` | Catalog (the tabs and search filter it in the browser) |
| 5 | `GET /api/products/{id}` | Product pages |
| 6 | `POST /api/orders` | Checkout (the cart lives in the browser, so checkout is the server call) |
| 7 | `GET /api/orders/{id}` | Order confirmation / details |
| 8 | `POST /api/orders/{id}/cancel` | Cancels the test order again so stock is returned (`CANCEL_RATIO`) |
| 9 | `GET /api/orders` | "My orders" |

All requests go to the **public portal URL**; the portal forwards `/api/*` to the private API, so
the test covers the whole chain: portal → VNet → API private endpoint → API → SQL private endpoint.

### How sign-in works in the test
The interactive Microsoft sign-in page (MFA, Conditional Access) cannot – and should not – be load tested:
it is Microsoft's service, not part of this app, and Entra ID throttles automated sign-ins.
Instead the test uses a dedicated **load-test app registration**: virtual users get an app-only token with
its client secret (kept in Key Vault) and send `x-loadtest-user: <id>`. The API accepts this **only** from
client ids listed in its `LOADTEST_CLIENT_IDS` setting and turns each one into a synthetic shopper
`loadtest-<id>` – never an admin, and only able to see its own orders. Token validation (signature, issuer,
audience, expiry) runs exactly as for real users.

## Set up and run

```bash
RG=rg-msstore-43j30 ./deploy/setup-loadtest.sh
# heavier run:
RG=rg-msstore-43j30 USERS=200 SPAWN_RATE=10 DURATION=10m ENGINES=2 ./deploy/setup-loadtest.sh
```

The script creates the load-test app registration and secret, a Key Vault, the Azure Load Testing resource
and the test, allow-lists the client on the API and starts a run. Results: Azure portal → Azure Load Testing →
`lt-<name>` → Tests → `portal-e2e` (response times per step, requests/s, errors; add App Service and SQL
metrics on the **Monitoring** tab to see server-side CPU and DTU).

Pass/fail criteria: error rate > 5 % or average response time > 3 s fails the run; it stops automatically
if more than 50 % of requests fail for a minute.

## Run it locally (optional)

```bash
pip install locust
export TENANT_ID=... LOADTEST_CLIENT_ID=... LOADTEST_CLIENT_SECRET=... API_SCOPE=api://<api-app-id>/.default
locust -f loadtest/locustfile.py --host https://app-msstore-portal-xxxxx.azurewebsites.net
```

## Things to know
- **The database will be the bottleneck.** Azure SQL Basic (5 DTU) and App Service B1 are sized for a demo.
  Scale up before a big test (`az sql db update ... --service-objective S2`, `az appservice plan update ... --sku P1v3`).
- Test orders use cost center `LOADTEST` and products with ≥ 1000 in stock; with `CANCEL_RATIO=1.0` every
  test order is cancelled again. They still appear (as Cancelled) in the admin portal.
- When you are done, remove `LOADTEST_CLIENT_IDS` from the API's app settings and delete the load-test app registration.
