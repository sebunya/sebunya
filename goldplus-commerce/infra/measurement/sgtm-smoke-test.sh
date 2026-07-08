#!/usr/bin/env bash
set -e

DOMAIN="${1:-http://localhost}"

echo "Running sGTM Smoke Tests against $DOMAIN"

# 1. Check health
./sgtm-healthcheck.sh "$DOMAIN"

# 2. Check path whitelisting (Should be blocked)
BLOCKED_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DOMAIN/admin")
if [ "$BLOCKED_STATUS" -eq 404 ] || [ "$BLOCKED_STATUS" -eq 403 ]; then
  echo "✅ Path whitelisting working (Blocked /admin with $BLOCKED_STATUS)"
else
  echo "❌ Path whitelisting failed (Status: $BLOCKED_STATUS)"
  exit 1
fi

# 3. Check allowed path (Should pass proxy, though it might return 400 from GTM if no payload)
ALLOWED_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DOMAIN/g/collect")
if [ "$ALLOWED_STATUS" -ne 404 ]; then
  echo "✅ Path /g/collect correctly proxied (Status: $ALLOWED_STATUS)"
else
  echo "❌ Path proxy failed (Status: $ALLOWED_STATUS)"
  exit 1
fi

echo "Smoke tests passed."
