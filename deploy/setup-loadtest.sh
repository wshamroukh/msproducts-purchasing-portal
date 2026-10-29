#!/usr/bin/env bash
# =============================================================================
#  Azure Load Testing for the Microsoft Products Purchasing Portal
#
#  Creates (in the app's resource group):
#    - "<name>-loadtest" Entra ID app registration + client secret. Virtual users get an
#      app-only token with it and act as synthetic shoppers (loadtest-<id>, never admins)
#    - Key Vault holding that secret (RBAC)
#    - Azure Load Testing resource (system-assigned identity, reads the secret)
#    - A Locust test (loadtest/locustfile.py) against the PUBLIC portal URL:
#        sign-in token -> open portal (html/js/css/config) -> /api/me -> catalog
#        -> product pages -> checkout -> order confirmation -> cancel -> my orders
#  and allow-lists the load-test client on the API (LOADTEST_CLIENT_IDS app setting).
#
#  Usage (from the cloned repo, in WSL):
#    RG=rg-msstore-43j30 ./deploy/setup-loadtest.sh
#    RG=rg-msstore-43j30 USERS=200 SPAWN_RATE=10 DURATION=10m ENGINES=2 ./deploy/setup-loadtest.sh
#    RG=... RUN=false ./deploy/setup-loadtest.sh        # create/update the test, do not start a run
#
#  Re-running is safe: existing resources are reused and the test is updated.
# =============================================================================
set -euo pipefail

RG="${RG:-${1:-}}"
USERS="${USERS:-50}"               # concurrent virtual users
SPAWN_RATE="${SPAWN_RATE:-5}"      # users started per second
DURATION="${DURATION:-5m}"         # test length (Locust format: 300s, 5m, 1h)
ENGINES="${ENGINES:-1}"            # load engines (each engine is one Azure-hosted test machine)
CANCEL_RATIO="${CANCEL_RATIO:-1.0}" # share of test orders cancelled again (returns the stock)
TEST_ID="${TEST_ID:-portal-e2e}"
RUN="${RUN:-true}"
LT_LOCATION="${LT_LOCATION:-}"     # Azure Load Testing region (default: resource group region)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCUSTFILE="$SCRIPT_DIR/../loadtest/locustfile.py"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

c_info='\033[1;36m'; c_ok='\033[1;32m'; c_warn='\033[1;33m'; c_err='\033[1;31m'; c_off='\033[0m'
step() { echo -e "\n${c_info}==> $*${c_off}" >&2; }
ok()   { echo -e "${c_ok}    ✔ $*${c_off}" >&2; }
warn() { echo -e "${c_warn}    ! $*${c_off}" >&2; }
die()  { echo -e "${c_err}ERROR: $*${c_off}" >&2; exit 1; }
retry() {
  local n=$1; shift; local i=1
  until "$@"; do
    [[ $i -ge $n ]] && return 1
    warn "retrying in $((i * 10))s ($i/$n)…"; sleep $((i * 10)); i=$((i + 1))
  done
}

# ----------------------------- checks ---------------------------------------
[[ -n "$RG" ]] || die "Usage: RG=<resource group of the deployment> $0"
[[ -f "$LOCUSTFILE" ]] || die "loadtest/locustfile.py not found next to this script's folder - run it from the cloned repo"
command -v az >/dev/null || die "Azure CLI not found - run azure-deploy.sh first (it installs it) or install it"
az account show >/dev/null 2>&1 || az login --use-device-code -o none
az config set extension.use_dynamic_install=yes_without_prompt -o none 2>/dev/null || true
az extension add --name load --upgrade -o none 2>/dev/null || az extension add --name load -o none

step "Reading the deployment in $RG"
az group show -n "$RG" -o none 2>/dev/null || die "Resource group $RG not found"
LOCATION=$(az group show -n "$RG" --query location -o tsv)
LT_LOCATION="${LT_LOCATION:-$LOCATION}"
NAME="${RG#rg-}"
find_app() { az webapp list -g "$RG" --query "[?contains(name, '-$1-')].name | [0]" -o tsv; }
API_APP=$(find_app api); PORTAL_APP=$(find_app portal)
[[ -n "$API_APP" && -n "$PORTAL_APP" ]] || die "Could not find the api / portal web apps in $RG"
PORTAL_URL="https://$(az webapp show -g "$RG" -n "$PORTAL_APP" --query defaultHostName -o tsv)"
TENANT_ID=$(az account show --query tenantId -o tsv)
ME_OID=$(az ad signed-in-user show --query id -o tsv)
setting() { az webapp config appsettings list -g "$RG" -n "$1" --query "[?name=='$2'].value | [0]" -o tsv; }
API_CLIENT_ID=$(setting "$API_APP" API_CLIENT_ID)
[[ -n "$API_CLIENT_ID" ]] || die "API_CLIENT_ID app setting not found on $API_APP"
API_SCOPE="api://$API_CLIENT_ID/.default"
ok "Portal $PORTAL_URL   API app id $API_CLIENT_ID"

# ----------------------------- load-test identity ---------------------------
step "Load-test app registration"
LT_APP_NAME="${NAME}-loadtest"
LT_CLIENT_ID=$(az ad app list --display-name "$LT_APP_NAME" --query "[0].appId" -o tsv)
if [[ -z "$LT_CLIENT_ID" ]]; then
  LT_CLIENT_ID=$(az ad app create --display-name "$LT_APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)
  ok "created $LT_APP_NAME ($LT_CLIENT_ID)"
else
  ok "reusing $LT_APP_NAME ($LT_CLIENT_ID)"
fi
az ad sp create --id "$LT_CLIENT_ID" -o none >/dev/null 2>&1 || true
LT_SECRET=$(az ad app credential reset --id "$LT_CLIENT_ID" --append --display-name "azure-load-testing" \
  --years 1 --query password -o tsv 2>"$WORKDIR/secret.err") \
  || die "Could not create a client secret: $(tail -1 "$WORKDIR/secret.err")
       Your tenant may block client secrets on app registrations - tell me and I'll switch the test to certificates."
ok "client secret created (valid 1 year, stored only in Key Vault)"

# Emit the 'idtyp' claim so the API can recognise app-only tokens explicitly
API_OBJ_ID=$(az ad app show --id "$API_CLIENT_ID" --query id -o tsv)
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$API_OBJ_ID" \
  --headers "Content-Type=application/json" --only-show-errors -o none \
  --body '{"optionalClaims":{"accessToken":[{"name":"idtyp","essential":false,"additionalProperties":[]}]}}' \
  && ok "API token now carries the idtyp claim" || warn "Could not add the idtyp claim (not required)"
true

step "Allow-listing the load-test client on the API"
CURRENT=$(setting "$API_APP" LOADTEST_CLIENT_IDS)
if [[ ",$CURRENT," != *",$LT_CLIENT_ID,"* ]]; then
  az webapp config appsettings set -g "$RG" -n "$API_APP" -o none \
    --settings LOADTEST_CLIENT_IDS="${CURRENT:+$CURRENT,}$LT_CLIENT_ID"
  ok "LOADTEST_CLIENT_IDS set (the API restarts)"
else
  ok "already allow-listed"
fi

# ----------------------------- key vault ------------------------------------
step "Key Vault for the client secret"
KV=$(az keyvault list -g "$RG" --query "[?tags.purpose=='loadtest'].name | [0]" -o tsv)
if [[ -z "$KV" ]]; then
  KV="kv-lt-${NAME##*-}-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 4 || true)"
  az keyvault create -g "$RG" -n "$KV" -l "$LOCATION" --enable-rbac-authorization true --tags purpose=loadtest -o none
  ok "created $KV"
else
  ok "reusing $KV"
fi
KV_ID=$(az keyvault show -n "$KV" --query id -o tsv)
az role assignment create --assignee-object-id "$ME_OID" --assignee-principal-type User \
  --role "Key Vault Secrets Officer" --scope "$KV_ID" -o none 2>/dev/null || true
( umask 077; printf '%s' "$LT_SECRET" >"$WORKDIR/secret.txt" )   # via a file, not the command line
SECRET_URI=$(retry 6 az keyvault secret set --vault-name "$KV" -n loadtest-client-secret --file "$WORKDIR/secret.txt" \
  --query id -o tsv) || die "Could not write the secret to $KV (role assignment still propagating? re-run in a minute)"
SECRET_URI="${SECRET_URI%/*}"   # versionless URI -> always the latest secret
unset LT_SECRET; rm -f "$WORKDIR/secret.txt"
ok "secret stored: $SECRET_URI"

# ----------------------------- load testing resource ------------------------
step "Azure Load Testing resource"
LT_NAME="lt-${NAME}"
if ! az resource show -g "$RG" -n "$LT_NAME" --resource-type Microsoft.LoadTestService/loadTests -o none 2>/dev/null; then
  az resource create -g "$RG" -n "$LT_NAME" --resource-type Microsoft.LoadTestService/loadTests \
    --api-version 2022-12-01 --is-full-object -o none \
    --properties "{\"location\":\"$LT_LOCATION\",\"identity\":{\"type\":\"SystemAssigned\"},\"properties\":{\"description\":\"Load tests for $PORTAL_URL\"}}" \
    || die "Could not create Azure Load Testing in $LT_LOCATION - try another region, e.g. LT_LOCATION=southeastasia"
  ok "created $LT_NAME ($LT_LOCATION)"
else
  ok "reusing $LT_NAME"
fi
LT_ID=$(az resource show -g "$RG" -n "$LT_NAME" --resource-type Microsoft.LoadTestService/loadTests --query id -o tsv)
LT_MI=$(az resource show --ids "$LT_ID" --query identity.principalId -o tsv)
az role assignment create --assignee-object-id "$LT_MI" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$KV_ID" -o none 2>/dev/null || true
az role assignment create --assignee-object-id "$ME_OID" --assignee-principal-type User \
  --role "Load Test Contributor" --scope "$LT_ID" -o none 2>/dev/null || true
ok "Load Testing identity can read the secret; you are Load Test Contributor"

# ----------------------------- test definition -----------------------------
step "Creating / updating test '$TEST_ID'"
cp "$LOCUSTFILE" "$WORKDIR/locustfile.py"
cat >"$WORKDIR/loadtest.yaml" <<YAML
version: v0.1
testId: $TEST_ID
displayName: Purchasing portal - shopper journey
description: Sign-in token, open portal, browse catalog and products, checkout, cancel, my orders
testPlan: locustfile.py
testType: Locust
engineInstances: $ENGINES
env:
  - name: LOCUST_HOST
    value: "$PORTAL_URL"
  - name: LOCUST_USERS
    value: "$USERS"
  - name: LOCUST_SPAWN_RATE
    value: "$SPAWN_RATE"
  - name: LOCUST_RUN_TIME
    value: "$DURATION"
  - name: TENANT_ID
    value: "$TENANT_ID"
  - name: LOADTEST_CLIENT_ID
    value: "$LT_CLIENT_ID"
  - name: API_SCOPE
    value: "$API_SCOPE"
  - name: CANCEL_RATIO
    value: "$CANCEL_RATIO"
secrets:
  - name: LOADTEST_CLIENT_SECRET
    value: "$SECRET_URI"
failureCriteria:
  - percentage(error) > 5
  - avg(response_time_ms) > 3000
autoStop:
  errorPercentage: 50
  timeWindow: 60
YAML
if az load test show --load-test-resource "$LT_NAME" -g "$RG" --test-id "$TEST_ID" -o none 2>/dev/null; then
  retry 3 az load test update --load-test-resource "$LT_NAME" -g "$RG" --test-id "$TEST_ID" \
    --load-test-config-file "$WORKDIR/loadtest.yaml" -o none
  ok "updated"
else
  retry 3 az load test create --load-test-resource "$LT_NAME" -g "$RG" --test-id "$TEST_ID" \
    --load-test-config-file "$WORKDIR/loadtest.yaml" -o none
  ok "created"
fi
ok "$USERS users, +$SPAWN_RATE/s, $DURATION, $ENGINES engine(s) against $PORTAL_URL"

# remember the extra app registration for cleanup.sh
for f in deployment-*"${NAME##*-}".env; do
  if [[ -f "$f" ]] && ! grep -q '^LOADTEST_CLIENT_ID=' "$f"; then echo "LOADTEST_CLIENT_ID=$LT_CLIENT_ID" >>"$f"; fi
done

# ----------------------------- run -----------------------------------------
if [[ "$RUN" == "true" ]]; then
  step "Starting a test run (the API was just restarted - give it a minute)"
  sleep 60
  RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
  az load test-run create --load-test-resource "$LT_NAME" -g "$RG" --test-id "$TEST_ID" \
    --test-run-id "$RUN_ID" --display-name "$RUN_ID" --no-wait -o none
  ok "run $RUN_ID started"
fi

echo -e "\n${c_ok}Load testing ready.${c_off}"
echo "  Results : Azure portal -> Azure Load Testing -> $LT_NAME -> Tests -> $TEST_ID"
echo "  Run again: az load test-run create --load-test-resource $LT_NAME -g $RG --test-id $TEST_ID --test-run-id run-\$(date +%s)"
echo "  Change load: re-run this script with USERS=, SPAWN_RATE=, DURATION=, ENGINES= (or edit the test in the portal)"
echo "  Load-test app registration: $LT_APP_NAME ($LT_CLIENT_ID) - delete it when you are done:"
echo "     az ad app delete --id $LT_CLIENT_ID"
