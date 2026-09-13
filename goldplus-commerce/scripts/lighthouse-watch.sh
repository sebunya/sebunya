#!/usr/bin/env bash
# Lighthouse Watch — host runner (2026-09-13).
#
# Runs REAL Lighthouse (the same engine PageSpeed Insights uses) against the
# live storefront for every URL in LIGHTHOUSE_WATCH_URLS, mobile and desktop,
# then posts the results to the API, which stores them as Web Vitals rows,
# compares every category with its target and raises or resolves alerts.
#
#   ./scripts/lighthouse-watch.sh [reason]        # reason is logged: cron | deploy | manual
#
# Scheduling: a cron entry every 6 hours plus a call at the end of every deploy
# (scripts/deploy-prod.sh). Chromium comes from the Playwright image already
# on the host; the lighthouse package is cached in a named volume so a run
# costs no download after the first. One run takes ~3 minutes on this host
# and is CPU-limited to leave room for the site.
set -euo pipefail
cd "$(dirname "$0")/.."
REASON="${1:-manual}"
LOG_DIR="${LIGHTHOUSE_WATCH_LOG_DIR:-/var/log/goldplus}"; mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR=/tmp
LOG="$LOG_DIR/lighthouse-watch.log"
exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) lighthouse-watch start reason=$REASON"

TOKEN="$(grep -E '^LIGHTHOUSE_WATCH_TOKEN=' .env.production | cut -d= -f2- | tr -d '"' || true)"
if [ "${#TOKEN}" -lt 32 ]; then echo "STOP: LIGHTHOUSE_WATCH_TOKEN missing from .env.production"; exit 1; fi
API="${LIGHTHOUSE_WATCH_API:-https://api.shopgoldplus.com}"
URLS="${LIGHTHOUSE_WATCH_URLS:-https://shopgoldplus.com/ https://shopgoldplus.com/shop}"
IMAGE="${LIGHTHOUSE_WATCH_IMAGE:-mcr.microsoft.com/playwright:v1.61.1-noble}"

WORK="$(mktemp -d /tmp/lighthouse-watch.XXXXXX)"; trap 'rm -rf "$WORK"' EXIT
cp scripts/lighthouse-watch/run.mjs "$WORK/run.mjs"

# --cpus keeps a 2-core host responsive for customers while the audit runs.
# The npm cache volume keeps the lighthouse download to the first run only.
docker run --rm --cpus=1.5 --memory=1500m --shm-size=512m \
  -v "$WORK:/work" -v lighthouse-watch-npm:/root/.npm \
  -e URLS="$URLS" -e API="$API" -e TOKEN="$TOKEN" -e REASON="$REASON" \
  --entrypoint bash "$IMAGE" -c '
    set -e
    CHROME="$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -1)"
    cd /work
    for URL in $URLS; do
      SLUG="$(echo "$URL" | sed -E "s#https?://##; s#[^A-Za-z0-9]+#_#g")"
      for FF in mobile desktop; do
        if [ "$FF" = mobile ]; then FLAGS="--form-factor=mobile --screenEmulation.mobile --throttling-method=simulate"; else FLAGS="--preset=desktop"; fi
        npx -y lighthouse@12 "$URL" $FLAGS --chrome-path="$CHROME" --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage" \
          --output=json --output-path="/work/$SLUG.$FF.json" --quiet || echo "lighthouse failed for $URL $FF"
      done
    done
    node /work/run.mjs
  '
echo "=== $(date -u +%FT%TZ) lighthouse-watch end"
