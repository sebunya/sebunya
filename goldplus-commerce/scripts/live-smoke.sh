#!/usr/bin/env bash
# Live smoke after a roll: what a customer does, through Cloudflare and Caddy, not just GETs.
# 2026-10-14: every form post (cart, checkout, login) had been refused for a week with "Cross-site POST form
# submissions are forbidden" while every GET check stayed green. This script would have caught it on the first deploy.
# Usage: scripts/live-smoke.sh [https://shopgoldplus.com] [https://api.shopgoldplus.com]   (exit 1 on any failure)
set -u
SITE="${1:-https://shopgoldplus.com}"
API="${2:-https://api.shopgoldplus.com}"
fail=0
check() { # name, expected-ok (0/1), detail
  if [ "$2" = 1 ]; then echo "  ok    $1"; else echo "  FAIL  $1 ($3)"; fail=1; fi
}
echo "live smoke: $SITE / $API"
h=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/"); check "home page" "$([ "$h" = 200 ] && echo 1 || echo 0)" "HTTP $h"
h=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$API/health/ready"); check "api ready" "$([ "$h" = 200 ] && echo 1 || echo 0)" "HTTP $h"
for path in /cart /checkout /login /quote-request; do
  out=$(curl -s -w '\n%{http_code}' --max-time 15 -X POST "$SITE$path" -H "Origin: $SITE" -H 'Content-Type: application/x-www-form-urlencoded' --data 'smoke=1')
  code=$(printf '%s' "$out" | tail -n1)
  if printf '%s' "$out" | grep -q 'Cross-site'; then check "form post $path" 0 "refused as cross-site: customers cannot submit it"
  elif [ "$code" -ge 500 ] 2>/dev/null; then check "form post $path" 0 "HTTP $code"
  else check "form post $path" 1 ""; fi
done
evil=$(curl -s --max-time 15 -X POST "$SITE/cart" -H 'Origin: https://evil.example' -H 'Content-Type: application/x-www-form-urlencoded' --data 'smoke=1')
check "foreign origin still refused" "$(printf '%s' "$evil" | grep -q 'Cross-site' && echo 1 || echo 0)" "a cross-site form post was accepted"
if [ "$fail" = 1 ]; then echo "LIVE SMOKE FAILED: fix forward or roll back (docker tags rollback-<previous sha>)."; exit 1; fi
echo "live smoke passed"
