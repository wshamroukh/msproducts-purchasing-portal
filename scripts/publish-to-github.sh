#!/usr/bin/env bash
# Publishes this folder to https://github.com/wshamroukh/<repo>
# Usage: ./scripts/publish-to-github.sh [repo-name] [public|private]
# Uses the GitHub CLI (gh) when available, otherwise plain git (create the empty repo on github.com first).
set -euo pipefail
OWNER="wshamroukh"
REPO="${1:-msproducts-purchasing-portal}"
VISIBILITY="${2:-public}"
cd "$(dirname "$0")/.."

if [[ ! -d .git ]]; then
  git init -q -b main
fi
git add -A
git commit -q -m "Microsoft Products Purchasing Portal - n-tier sample (React SPA + Node.js API + Azure SQL + Entra ID)" || echo "Nothing new to commit"

if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 || gh auth login
  if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
    git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
    git push -u origin main
  else
    gh repo create "$OWNER/$REPO" --"$VISIBILITY" --source . --remote origin --push \
      --description "Sample n-tier app: employee purchasing portal + admin portal (React, Node.js, Azure SQL, Entra ID)"
  fi
else
  echo "GitHub CLI not found. Create an EMPTY repository named '$REPO' at https://github.com/new, then press Enter."
  read -r _
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
  git push -u origin main
fi
echo "Published: https://github.com/$OWNER/$REPO"
