#!/usr/bin/env bash
# restore-vercel.sh — restore promptmanuals.com from pmx backup to Vercel
# Usage: bash scripts/restore-vercel.sh
# Requires: GH_PAT, VERCEL_TOKEN env vars

set -euo pipefail

TEMP_DIR=$(mktemp -d)
BACKUP_REPO="https://github.com/vimokoshi/pmx.git"
PROJECT_ID="prj_dGEO3cfgJWyb2QTgmx0ZiOc9bdPA"
ORG_ID="team_eynfBSLB3HYyqJsWIG11urnr"

echo "=== Cloning pmx backup ==="
git clone --depth=1 "$BACKUP_REPO" "$TEMP_DIR/pmx-restore"
cd "$TEMP_DIR/pmx-restore"

echo "=== Installing dependencies ==="
npm ci

echo "=== Linking to Vercel ==="
vercel link \
  --org="$ORG_ID" \
  --project="promptmanuals.com" \
  --yes

echo "=== Pulling environment variables ==="
vercel env pull .vercel/.env.production.local --yes

echo "=== Deploying to production ==="
vercel deploy --prod --yes

echo "=== Restore complete ==="
rm -rf "$TEMP_DIR"
