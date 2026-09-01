#!/usr/bin/env bash
# Purge specific URLs from the Cloudflare edge cache.
#   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ZONE_ID=… ./scripts/cf-purge-urls.sh https://shopgoldplus.com/uploads/… [more urls]
# Needs an API token with "Zone → Cache Purge" permission (create it in the
# Cloudflare dashboard; never commit it). Why this exists: before 6952247e the
# edge cached a missing /uploads file as an immutable 404 for a year, and the
# only cure for an already-poisoned URL is a purge.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"; : "${CLOUDFLARE_ZONE_ID:?set CLOUDFLARE_ZONE_ID}"
[ "$#" -ge 1 ] || { echo "usage: $0 <url> [url…]"; exit 2; }
files=$(printf '%s\n' "$@" | python3 -c 'import json,sys; print(json.dumps({"files":[l.strip() for l in sys.stdin if l.strip()]}))')
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json" --data "$files" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); print("purged" if r.get("success") else r); sys.exit(0 if r.get("success") else 1)'
