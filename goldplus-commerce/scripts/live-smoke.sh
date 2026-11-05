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
# Visibility gaps N12 (2026-11-05): three read-only GETs, no crawl. The product sitemap must be a complete XML
# document, list the same product URLs as llms-full.txt (a ghost or missing offer shows as a difference), and /bulk
# must keep its canonical. Owner: whoever runs the deploy (deploy-prod.sh calls this script).
sm=$(curl -s --max-time 20 "$SITE/sitemaps/products.xml")
sm_urls=$(printf '%s' "$sm" | grep -o '<loc>[^<]*/products/[^<]*</loc>' | sed 's#<loc>\(.*\)</loc>#\1#' | sort -u)
sm_n=$(printf '%s' "$sm_urls" | grep -c . || true)
if printf '%s' "$sm" | head -c 200 | grep -q '<?xml' && printf '%s' "$sm" | grep -q '</urlset>' && [ "$sm_n" -gt 0 ]; then check "product sitemap is XML ($sm_n products)" 1 ""
else check "product sitemap is XML" 0 "not a complete urlset with product URLs"; fi
lf_urls=$(curl -s --max-time 20 "$SITE/llms-full.txt" | grep -o "$SITE/products/[a-z0-9-]*" | sort -u)
lf_n=$(printf '%s' "$lf_urls" | grep -c . || true)
if [ "$sm_urls" = "$lf_urls" ]; then check "sitemap and llms-full list the same $lf_n products" 1 ""
else check "sitemap and llms-full list the same products" 0 "sitemap $sm_n, llms-full $lf_n; differ: $(printf '%s\n%s\n' "$sm_urls" "$lf_urls" | sort | uniq -u | head -3 | tr '\n' ' ')"; fi
if curl -s --max-time 15 "$SITE/bulk" | grep -q "<link rel=\"canonical\" href=\"$SITE/bulk\""; then check "/bulk canonical" 1 ""
else check "/bulk canonical" 0 "missing or wrong canonical on /bulk"; fi
warn=0
hdr=$(mktemp); trap 'rm -f "$hdr"' EXIT
# post <path> <origin>: sets $code, $body and $challenged (Cloudflare answered with a challenge, not the shop).
post() {
  body=$(curl -s -D "$hdr" -w '\n%{http_code}' --max-time 15 -X POST "$SITE$1" -H "Origin: $2" -H 'Content-Type: application/x-www-form-urlencoded' --data 'smoke=1')
  code=$(printf '%s' "$body" | tail -n1)
  challenged=0; grep -qi '^cf-mitigated: *challenge' "$hdr" && challenged=1
}
# Both refusals: Astro's own ("Cross-site POST form submissions are forbidden") and the shop's origin check
# ("could not be verified as coming from our site").
refused() { printf '%s' "$body" | grep -qiE 'Cross-site|could not be verified'; }
for path in /cart /checkout /login /quote-request; do
  post "$path" "$SITE"
  if [ "$challenged" = 1 ]; then echo "  WARN  form post $path (Cloudflare challenged this server; not a customer result)"; warn=1
  elif refused; then check "form post $path" 0 "refused as cross-site: customers cannot submit it"
  elif [ "$code" = 000 ]; then check "form post $path" 0 "no answer (timeout or connection error)"
  elif [ "$code" = 401 ] || [ "$code" = 403 ] || [ "$code" = 429 ] || [ "$code" -ge 500 ] 2>/dev/null; then check "form post $path" 0 "HTTP $code"
  else check "form post $path" 1 ""; fi
done
post /cart https://evil.example
if [ "$challenged" = 1 ]; then echo "  WARN  foreign origin check (Cloudflare challenged this server)"; warn=1
else check "foreign origin still refused" "$(refused && echo 1 || echo 0)" "a cross-site form post was accepted (HTTP $code)"; fi
# Social sign-in (2026-10-15): Google and Facebook are switched on in .env.production. A line lost from that file, or a
# container started without it, silently removes the button; the api answers configured:false. Warn only: a deploy is
# not rolled back over a missing sign-in option, but the operator should know.
providers=$(curl -s --max-time 15 "$API/auth/social/providers")
for p in google facebook; do
  if printf '%s' "$providers" | grep -q "\"provider\":\"$p\",\"displayName\":\"[A-Za-z]*\",\"configured\":true"; then echo "  ok    sign-in with $p configured"
  else echo "  WARN  sign-in with $p NOT configured (check $(printf '%s' "$p" | tr a-z A-Z)_CLIENT_ID / _SECRET in .env.production, then restart api)"; warn=1; fi
done
[ "$warn" = 1 ] && echo "note: some checks were challenged by Cloudflare (Bot Fight Mode or a rate rule); run this from a browser network to be sure."
if [ "$fail" = 1 ]; then echo "LIVE SMOKE FAILED: fix forward or roll back (docker tags rollback-<previous sha>)."; exit 1; fi
echo "live smoke passed"
