#!/usr/bin/env bash
# Deletes everything created by azure-deploy.sh
# Usage: ./cleanup.sh deployment-msstore-xxxxx.env
set -euo pipefail
[[ $# -eq 1 && -f "$1" ]] || { echo "Usage: $0 <deployment-*.env file written by azure-deploy.sh>"; exit 1; }
# shellcheck disable=SC1090
source "$1"
read -r -p "Delete resource group '$RG' and the 3 Entra ID app registrations? [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || exit 0
for id in "${PORTAL_CLIENT_ID:-}" "${ADMIN_CLIENT_ID:-}" "${API_CLIENT_ID:-}"; do
  [[ -z "$id" ]] && continue
  if az ad app delete --id "$id"; then echo "Deleted app registration $id"; fi
done
az group exists -n "$RG" | grep -q true && az group delete -n "$RG" --yes --no-wait && echo "Resource group $RG is being deleted (takes a few minutes)"
