#!/usr/bin/env bash
set -e

echo "Checking sGTM health..."

DOMAIN="${1:-http://localhost}"

# Check production server
PROD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DOMAIN/healthz")

if [ "$PROD_STATUS" -eq 200 ]; then
  echo "✅ Production sGTM is healthy (Status: $PROD_STATUS)"
else
  echo "❌ Production sGTM health check failed (Status: $PROD_STATUS)"
  exit 1
fi

# Check preview server (simulating preview header)
PREV_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Gtm-Server-Preview: 1" "$DOMAIN/healthz")

if [ "$PREV_STATUS" -eq 200 ]; then
  echo "✅ Preview sGTM is healthy (Status: $PREV_STATUS)"
else
  echo "❌ Preview sGTM health check failed (Status: $PREV_STATUS)"
  exit 1
fi

echo "All health checks passed."
