#!/usr/bin/env bash
# =============================================================================
#  Microsoft Products Purchasing Portal - one-shot Azure deployment (az cli)
#
#  Creates:
#    - Resource group
#    - Virtual network with a private endpoint + private DNS zone for SQL
#    - Azure SQL logical server (Microsoft Entra-only auth, public access DISABLED) + database
#    - Linux App Service plan + 3 web apps (API, purchasing portal, admin portal)
#    - API web app integrated into the VNet; its system-assigned managed identity
#      is the SQL Entra admin, so it creates the schema + sample data itself at start-up
#      (no passwords, no firewall rules, works with "deny public network access" policies)
#    - 3 Entra ID app registrations (API with scope + Store.Admin app role, 2 SPAs)
#  Then clones the GitHub repo, builds the apps, creates the schema + sample
#  data and zip-deploys everything.
#
#  Designed for WSL (Ubuntu/Debian) - also works on Linux and Azure Cloud Shell.
#  Missing prerequisites (Azure CLI, git, Node.js 22, zip, curl) are installed
#  automatically with apt (you may be asked for your sudo password).
#  Windows binaries visible through /mnt/c are ignored - native Linux tools are used.
#
#  Usage:
#    ./azure-deploy.sh                                   # defaults below (Central India)
#    SUBSCRIPTION="My Sub" ./azure-deploy.sh             # pick a subscription
#    LOCATION=westeurope PREFIX=msshop ./azure-deploy.sh
#    ADMIN_UPNS="alice@contoso.com,bob@contoso.com" ./azure-deploy.sh
# =============================================================================
set -euo pipefail

# ----------------------------- parameters -----------------------------------
REPO_URL="${REPO_URL:-https://github.com/wshamroukh/msproducts-purchasing-portal.git}"
BRANCH="${BRANCH:-main}"
LOCATION="${LOCATION:-centralindia}"
SUBSCRIPTION="${SUBSCRIPTION:-}"          # subscription name or id (default: current az cli subscription)
PREFIX="${PREFIX:-msstore}"
SUFFIX="${SUFFIX:-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 5 || true)}"
RG="${RG:-rg-${PREFIX}-${SUFFIX}}"
APP_SKU="${APP_SKU:-B1}"
NODE_RUNTIME="${NODE_RUNTIME:-NODE:22-lts}"
SQL_SKU="${SQL_SKU:-Basic}"
DB_NAME="${DB_NAME:-msstoredb}"
ADMIN_UPNS="${ADMIN_UPNS:-}"          # extra users (comma separated) to receive the Store.Admin role
ADMIN_ROLE="Store.Admin"
SCOPE_NAME="access_as_user"

SQL_SERVER="sql-${PREFIX}-${SUFFIX}"
PLAN="asp-${PREFIX}-${SUFFIX}"
API_APP="app-${PREFIX}-api-${SUFFIX}"
PORTAL_APP="app-${PREFIX}-portal-${SUFFIX}"
ADMIN_APP="app-${PREFIX}-admin-${SUFFIX}"
VNET="vnet-${PREFIX}-${SUFFIX}"
VNET_CIDR="${VNET_CIDR:-10.20.0.0/16}"
APP_SUBNET_CIDR="${APP_SUBNET_CIDR:-10.20.1.0/24}"
PE_SUBNET_CIDR="${PE_SUBNET_CIDR:-10.20.2.0/24}"
SQL_DNS_ZONE="privatelink.database.windows.net"

WORKDIR="$(mktemp -d)"
OUT_FILE="${OUT_FILE:-$PWD/deployment-${PREFIX}-${SUFFIX}.env}"

# ----------------------------- helpers --------------------------------------
c_info='\033[1;36m'; c_ok='\033[1;32m'; c_warn='\033[1;33m'; c_err='\033[1;31m'; c_off='\033[0m'
step() { echo -e "\n${c_info}==> $*${c_off}" >&2; }
ok()   { echo -e "${c_ok}    ✔ $*${c_off}" >&2; }
warn() { echo -e "${c_warn}    ! $*${c_off}" >&2; }
die()  { echo -e "${c_err}ERROR: $*${c_off}" >&2; exit 1; }
uuid() { node -e "console.log(require('crypto').randomUUID())"; }

# retry <attempts> <command...>   (Entra ID objects take a few seconds to replicate)
retry() {
  local n=$1; shift; local i=1
  until "$@"; do
    [[ $i -ge $n ]] && return 1
    warn "retrying in $((i * 5))s ($i/$n)…"; sleep $((i * 5)); i=$((i + 1))
  done
}
graph_patch() {
  az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/$1" \
    --headers "Content-Type=application/json" --body "$2" --only-show-errors >/dev/null
}

trap 'rm -rf "$WORKDIR"' EXIT

# state file (written as resources are created, so cleanup.sh works even after a failed run)
save() { echo "$1=$2" >>"$OUT_FILE"; }

# ----------------------------- prerequisites --------------------------------
# A command counts as installed only if it is a native Linux binary (not a Windows one under /mnt/*).
have() { local p; p=$(command -v "$1" 2>/dev/null) || return 1; [[ "$p" != /mnt/* ]]; }

SUDO=""
if [[ $EUID -ne 0 ]]; then
  have sudo || die "sudo is required to install prerequisites (or run the script as root)"
  SUDO="sudo"
fi
APT_UPDATED=0
apt_install() {
  have apt-get || die "apt-get not found. Install these manually and re-run: $*"
  if [[ $APT_UPDATED -eq 0 ]]; then $SUDO apt-get update -qq; APT_UPDATED=1; fi
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
}

step "Checking prerequisites"
if grep -qi microsoft /proc/version 2>/dev/null; then ok "Running in WSL"; fi

MISSING=()
for t in curl git zip unzip; do have "$t" || MISSING+=("$t"); done
have gpg || MISSING+=("gnupg")
if [[ ${#MISSING[@]} -gt 0 ]]; then
  warn "Installing: ${MISSING[*]}"
  apt_install ca-certificates lsb-release "${MISSING[@]}"
fi
ok "curl, git, zip"

NODE_OK=0
if have node && have npm; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [[ $NODE_MAJOR -ge 20 ]] && NODE_OK=1
fi
if [[ $NODE_OK -eq 0 ]]; then
  warn "Installing Node.js 22 LTS (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "$WORKDIR/nodesource_setup.sh"
  $SUDO bash "$WORKDIR/nodesource_setup.sh" >/dev/null
  APT_UPDATED=1
  apt_install nodejs
  hash -r
  have node || die "Node.js installation failed"
fi
ok "Node.js $(node -v), npm $(npm -v)"

if ! have az; then
  warn "Installing Azure CLI"
  curl -sL https://aka.ms/InstallAzureCLIDeb -o "$WORKDIR/install_az.sh"
  $SUDO bash "$WORKDIR/install_az.sh" >/dev/null
  hash -r
  have az || die "Azure CLI installation failed"
fi
ok "Azure CLI $(az version --query '"azure-cli"' -o tsv 2>/dev/null)"

# ----------------------------- sign in --------------------------------------
if ! az account show >/dev/null 2>&1; then
  step "Signing in to Azure (device code - open the link in your Windows browser)"
  az login --use-device-code -o none
fi
if [[ -n "$SUBSCRIPTION" ]]; then
  az account set --subscription "$SUBSCRIPTION"
fi

TENANT_ID=$(az account show --query tenantId -o tsv)
SUB_ID=$(az account show --query id -o tsv)
SUB_NAME=$(az account show --query name -o tsv)
ME_OID=$(az ad signed-in-user show --query id -o tsv)
ME_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
ok "Subscription : $SUB_NAME ($SUB_ID)"
ok "Tenant       : $TENANT_ID"
ok "Signed in as : $ME_UPN"
ok "Location     : $LOCATION   Resource group: $RG"
: >"$OUT_FILE"; save RG "$RG"; save LOCATION "$LOCATION"
ok "State file   : $OUT_FILE"

# ----------------------------- source code ----------------------------------
step "Cloning $REPO_URL ($BRANCH)"
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$WORKDIR/src"
SRC="$WORKDIR/src"
ok "Cloned to $SRC"

# ----------------------------- resource group -------------------------------
step "Creating resource group"
az group create -n "$RG" -l "$LOCATION" --tags app=msproducts-purchasing-portal -o none
ok "$RG"

# ----------------------------- app service ----------------------------------
step "Creating App Service plan ($APP_SKU, Linux) and web apps"
az appservice plan create -g "$RG" -n "$PLAN" -l "$LOCATION" --is-linux --sku "$APP_SKU" -o none
for app in "$API_APP" "$PORTAL_APP" "$ADMIN_APP"; do
  az webapp create -g "$RG" -p "$PLAN" -n "$app" --runtime "$NODE_RUNTIME" -o none
  az webapp update -g "$RG" -n "$app" --https-only true -o none
  az webapp config set -g "$RG" -n "$app" --always-on true --ftps-state Disabled --min-tls-version 1.2 -o none
  ok "$app"
done
API_HOST=$(az webapp show -g "$RG" -n "$API_APP" --query defaultHostName -o tsv)
PORTAL_HOST=$(az webapp show -g "$RG" -n "$PORTAL_APP" --query defaultHostName -o tsv)
ADMIN_HOST=$(az webapp show -g "$RG" -n "$ADMIN_APP" --query defaultHostName -o tsv)
API_URL="https://$API_HOST"; PORTAL_URL="https://$PORTAL_HOST"; ADMIN_URL="https://$ADMIN_HOST"

step "Enabling the managed identity of the API"
API_MI_OID=$(az webapp identity assign -g "$RG" -n "$API_APP" --query principalId -o tsv)
API_MI_APPID=""
for _ in 1 2 3 4 5 6 7 8 9; do
  API_MI_APPID=$(az ad sp show --id "$API_MI_OID" --query appId -o tsv 2>/dev/null || true)
  [[ -n "$API_MI_APPID" ]] && break
  sleep 10
done
[[ -n "$API_MI_APPID" ]] || die "Could not read the managed identity's client id"
ok "principalId $API_MI_OID (clientId $API_MI_APPID)"

# ----------------------------- Entra ID -------------------------------------
step "Registering the API in Microsoft Entra ID"
API_CLIENT_ID=$(az ad app create --display-name "${PREFIX}-api-${SUFFIX}" --sign-in-audience AzureADMyOrg --query appId -o tsv)
save API_CLIENT_ID "$API_CLIENT_ID"
API_OBJ_ID=$(az ad app show --id "$API_CLIENT_ID" --query id -o tsv)
SCOPE_ID=$(uuid); ROLE_ID=$(uuid)
SCOPES_JSON=$(cat <<JSON
[{"id":"$SCOPE_ID","value":"$SCOPE_NAME","type":"User","isEnabled":true,
  "adminConsentDisplayName":"Access the purchasing portal API",
  "adminConsentDescription":"Allows the app to call the purchasing portal API as the signed-in user.",
  "userConsentDisplayName":"Access the purchasing portal API",
  "userConsentDescription":"Allows the app to call the purchasing portal API on your behalf."}]
JSON
)
retry 6 graph_patch "applications/$API_OBJ_ID" "$(cat <<JSON
{"identifierUris":["api://$API_CLIENT_ID"],
 "api":{"requestedAccessTokenVersion":2,"oauth2PermissionScopes":$SCOPES_JSON},
 "appRoles":[{"id":"$ROLE_ID","allowedMemberTypes":["User"],"value":"$ADMIN_ROLE","displayName":"Store Administrator",
              "description":"Can process orders, dispatch them to stores and manage products in the admin portal.","isEnabled":true}]}
JSON
)"
az ad sp create --id "$API_CLIENT_ID" -o none 2>/dev/null || true
API_SP_ID=$(retry 6 az ad sp show --id "$API_CLIENT_ID" --query id -o tsv)
ok "API app id $API_CLIENT_ID  (scope api://$API_CLIENT_ID/$SCOPE_NAME, app role $ADMIN_ROLE)"

create_spa() { # <display-name> <url>   -> prints the new appId
  local id obj
  id=$(az ad app create --display-name "$1" --sign-in-audience AzureADMyOrg --query appId -o tsv)
  obj=$(az ad app show --id "$id" --query id -o tsv)
  retry 6 graph_patch "applications/$obj" "$(cat <<JSON
{"spa":{"redirectUris":["$2/","http://localhost:5173/","http://localhost:5174/"]},
 "requiredResourceAccess":[
   {"resourceAppId":"$API_CLIENT_ID","resourceAccess":[{"id":"$SCOPE_ID","type":"Scope"}]},
   {"resourceAppId":"00000003-0000-0000-c000-000000000000","resourceAccess":[{"id":"e1fe6dd8-ba31-4d61-89e7-88639da4683d","type":"Scope"}]}]}
JSON
)"
  az ad sp create --id "$id" -o none 2>/dev/null || true
  echo "$id"
}

step "Registering the purchasing portal and admin portal SPAs"
PORTAL_CLIENT_ID=$(create_spa "${PREFIX}-portal-${SUFFIX}" "$PORTAL_URL"); save PORTAL_CLIENT_ID "$PORTAL_CLIENT_ID"
ok "Portal app id $PORTAL_CLIENT_ID"
ADMIN_CLIENT_ID=$(create_spa "${PREFIX}-admin-${SUFFIX}" "$ADMIN_URL"); save ADMIN_CLIENT_ID "$ADMIN_CLIENT_ID"
ok "Admin app id  $ADMIN_CLIENT_ID"

step "Pre-authorizing both SPAs for the API scope"
retry 6 graph_patch "applications/$API_OBJ_ID" "$(cat <<JSON
{"api":{"requestedAccessTokenVersion":2,"oauth2PermissionScopes":$SCOPES_JSON,
 "preAuthorizedApplications":[{"appId":"$PORTAL_CLIENT_ID","delegatedPermissionIds":["$SCOPE_ID"]},
                              {"appId":"$ADMIN_CLIENT_ID","delegatedPermissionIds":["$SCOPE_ID"]}]}}
JSON
)"
ok "done"

step "Granting the $ADMIN_ROLE app role"
assign_admin() { # <user object id> <label>
  if retry 6 az rest --method POST --only-show-errors -o none \
      --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$API_SP_ID/appRoleAssignedTo" \
      --headers "Content-Type=application/json" \
      --body "{\"principalId\":\"$1\",\"resourceId\":\"$API_SP_ID\",\"appRoleId\":\"$ROLE_ID\"}"; then
    ok "$2"
  else
    warn "Could not assign $ADMIN_ROLE to $2 - assign it manually under Enterprise applications"
  fi
}
assign_admin "$ME_OID" "$ME_UPN"
IFS=',' read -ra EXTRA <<<"$ADMIN_UPNS"
for upn in "${EXTRA[@]}"; do
  upn=$(echo "$upn" | xargs); [[ -z "$upn" ]] && continue
  oid=$(az ad user show --id "$upn" --query id -o tsv 2>/dev/null || true)
  if [[ -n "$oid" ]]; then assign_admin "$oid" "$upn"; else warn "User $upn not found"; fi
done

# Best effort: tenant-wide consent for sign-in + User.Read (requires an admin; otherwise users consent at first sign-in)
for id in "$PORTAL_CLIENT_ID" "$ADMIN_CLIENT_ID"; do
  if az ad app permission admin-consent --id "$id" -o none 2>/dev/null; then ok "Admin consent granted for $id"
  else warn "Admin consent not granted for $id (users will be asked to consent at first sign-in)"; fi
done

# ----------------------------- network --------------------------------------
step "Creating the virtual network"
az network vnet create -g "$RG" -n "$VNET" -l "$LOCATION" --address-prefixes "$VNET_CIDR" \
  --subnet-name snet-app --subnet-prefixes "$APP_SUBNET_CIDR" -o none
az network vnet subnet update -g "$RG" --vnet-name "$VNET" -n snet-app --delegations Microsoft.Web/serverFarms -o none
az network vnet subnet create -g "$RG" --vnet-name "$VNET" -n snet-pe --address-prefixes "$PE_SUBNET_CIDR" -o none
ok "$VNET (snet-app $APP_SUBNET_CIDR for App Service, snet-pe $PE_SUBNET_CIDR for private endpoints)"

# ----------------------------- Azure SQL ------------------------------------
step "Creating Azure SQL server (Entra-only auth, no public access) and database"
# The API's managed identity is the Entra admin, so the API can create its own schema and sample data.
az sql server create -g "$RG" -n "$SQL_SERVER" -l "$LOCATION" \
  --enable-ad-only-auth --external-admin-principal-type Application \
  --external-admin-name "$API_APP" --external-admin-sid "$API_MI_APPID" \
  --enable-public-network false --minimal-tls-version 1.2 -o none
SQL_FQDN=$(az sql server show -g "$RG" -n "$SQL_SERVER" --query fullyQualifiedDomainName -o tsv)
SQL_ID=$(az sql server show -g "$RG" -n "$SQL_SERVER" --query id -o tsv)
az sql db create -g "$RG" -s "$SQL_SERVER" -n "$DB_NAME" --service-objective "$SQL_SKU" \
  --backup-storage-redundancy Local -o none
ok "$SQL_FQDN / $DB_NAME  (Entra admin: managed identity of $API_APP)"

step "Creating the SQL private endpoint and private DNS zone"
az network private-endpoint create -g "$RG" -n "pe-$SQL_SERVER" -l "$LOCATION" \
  --vnet-name "$VNET" --subnet snet-pe --private-connection-resource-id "$SQL_ID" \
  --group-id sqlServer --connection-name "plc-$SQL_SERVER" -o none
az network private-dns zone create -g "$RG" -n "$SQL_DNS_ZONE" -o none
az network private-dns link vnet create -g "$RG" -z "$SQL_DNS_ZONE" -n "link-$VNET" \
  --virtual-network "$VNET" --registration-enabled false -o none
az network private-endpoint dns-zone-group create -g "$RG" --endpoint-name "pe-$SQL_SERVER" \
  -n default --private-dns-zone "$SQL_DNS_ZONE" --zone-name sql -o none
ok "$SQL_FQDN now resolves to a private IP inside $VNET"

step "Connecting the API web app to the virtual network"
az webapp vnet-integration add -g "$RG" -n "$API_APP" --vnet "$VNET" --subnet snet-app -o none
az webapp config set -g "$RG" -n "$API_APP" --vnet-route-all-enabled true -o none
ok "$API_APP -> $VNET/snet-app"

# ----------------------------- build ----------------------------------------
step "Building the API"
(cd "$SRC/api" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
(cd "$SRC/api" && zip -qr "$WORKDIR/api.zip" src db scripts package.json node_modules)
ok "api.zip"

build_spa() { # <folder>
  (cd "$SRC/$1" && npm install --no-audit --no-fund --loglevel=error && npm run build --silent)
  rm -f "$SRC/$1/dist/config.json"   # generated at runtime from the App Settings
  (cd "$SRC/$1" && zip -qr "$WORKDIR/$1.zip" dist server.cjs)
  ok "$1.zip"
}
step "Building the purchasing portal"; build_spa portal
step "Building the admin portal";      build_spa admin

# ----------------------------- configure & deploy ----------------------------
step "Configuring app settings"
API_SCOPE="api://$API_CLIENT_ID/$SCOPE_NAME"
az webapp config appsettings set -g "$RG" -n "$API_APP" -o none --settings \
  AUTH_MODE=entra TENANT_ID="$TENANT_ID" API_CLIENT_ID="$API_CLIENT_ID" API_SCOPE_NAME="$SCOPE_NAME" ADMIN_ROLE="$ADMIN_ROLE" \
  SQL_SERVER="$SQL_FQDN" SQL_DATABASE="$DB_NAME" SQL_AUTH=managed-identity DB_AUTO_INIT=true \
  CORS_ORIGINS="$PORTAL_URL,$ADMIN_URL" SCM_DO_BUILD_DURING_DEPLOYMENT=false
az webapp config set -g "$RG" -n "$API_APP" --startup-file "node src/server.js" -o none

az webapp config appsettings set -g "$RG" -n "$PORTAL_APP" -o none --settings \
  AUTH_MODE=entra TENANT_ID="$TENANT_ID" CLIENT_ID="$PORTAL_CLIENT_ID" API_SCOPE="$API_SCOPE" API_BASE_URL="$API_URL" \
  APP_TITLE="Microsoft Products Purchasing Portal" SCM_DO_BUILD_DURING_DEPLOYMENT=false
az webapp config set -g "$RG" -n "$PORTAL_APP" --startup-file "node server.cjs" -o none

az webapp config appsettings set -g "$RG" -n "$ADMIN_APP" -o none --settings \
  AUTH_MODE=entra TENANT_ID="$TENANT_ID" CLIENT_ID="$ADMIN_CLIENT_ID" API_SCOPE="$API_SCOPE" API_BASE_URL="$API_URL" \
  APP_TITLE="Purchasing Portal - Admin" SCM_DO_BUILD_DURING_DEPLOYMENT=false
az webapp config set -g "$RG" -n "$ADMIN_APP" --startup-file "node server.cjs" -o none
ok "done"

step "Deploying code (zip deploy)"
az webapp deploy -g "$RG" -n "$API_APP"    --src-path "$WORKDIR/api.zip"    --type zip -o none && ok "$API_APP"
az webapp deploy -g "$RG" -n "$PORTAL_APP" --src-path "$WORKDIR/portal.zip" --type zip -o none && ok "$PORTAL_APP"
az webapp deploy -g "$RG" -n "$ADMIN_APP"  --src-path "$WORKDIR/admin.zip"  --type zip -o none && ok "$ADMIN_APP"

step "Waiting for the API to report healthy (first start creates the tables and sample data)"
for i in $(seq 1 30); do
  status=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "$API_URL/api/health" || true)
  if [[ "$status" == "200" ]]; then ok "API healthy"; break; fi
  [[ $i -eq 30 ]] && warn "API not healthy yet - check: az webapp log tail -g $RG -n $API_APP"
  sleep 10
done

# ----------------------------- summary --------------------------------------
cat >"$OUT_FILE" <<ENV
VNET=$VNET
RG=$RG
LOCATION=$LOCATION
SQL_SERVER=$SQL_FQDN
DB_NAME=$DB_NAME
API_APP=$API_APP
PORTAL_APP=$PORTAL_APP
ADMIN_APP=$ADMIN_APP
API_URL=$API_URL
PORTAL_URL=$PORTAL_URL
ADMIN_URL=$ADMIN_URL
TENANT_ID=$TENANT_ID
API_CLIENT_ID=$API_CLIENT_ID
PORTAL_CLIENT_ID=$PORTAL_CLIENT_ID
ADMIN_CLIENT_ID=$ADMIN_CLIENT_ID
ENV

echo -e "\n${c_ok}=====================================================================${c_off}"
echo -e "${c_ok} Deployment complete${c_off}"
echo -e "${c_ok}=====================================================================${c_off}"
echo "  Purchasing portal : $PORTAL_URL"
echo "  Admin portal      : $ADMIN_URL   ($ME_UPN has the $ADMIN_ROLE role)"
echo "  API health        : $API_URL/api/health"
echo "  Settings saved to : $OUT_FILE   (used by cleanup.sh)"
echo
echo "  Note: the first request can take ~30-60s while the apps warm up."
