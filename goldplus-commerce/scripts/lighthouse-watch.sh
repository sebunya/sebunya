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
# Scheduling (owner decision 2026-09-13): AT MOST ONE AUTOMATIC RUN EVERY 96 HOURS.
# Cron checks daily and the deploy hook calls after every roll, but both pass
# through the interval guard below and are skipped inside the window; only
# `manual` bypasses it. Chromium comes from the Playwright image already on the
# host; the lighthouse package is cached in a named volume. One run takes
# ~3 minutes and is CPU-limited to leave room for the site.
set -euo pipefail
cd "$(dirname "$0")/.."
REASON="${1:-manual}"
LOG_DIR="${LIGHTHOUSE_WATCH_LOG_DIR:-/var/log/goldplus}"; mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR=/tmp
LOG="$LOG_DIR/lighthouse-watch.log"
STAMP="$LOG_DIR/lighthouse-watch.last-run"
MIN_HOURS="${LIGHTHOUSE_WATCH_MIN_INTERVAL_HOURS:-96}"
exec >>"$LOG" 2>&1
if [ "$REASON" != "manual" ] && [ -f "$STAMP" ]; then
  AGE=$(( ( $(date +%s) - $(cat "$STAMP") ) / 3600 ))
  if [ "$AGE" -lt "$MIN_HOURS" ]; then
    echo "=== $(date -u +%FT%TZ) lighthouse-watch skipped reason=$REASON: last run ${AGE}h ago, minimum interval ${MIN_HOURS}h"
    exit 0
  fi
fi
echo "=== $(date -u +%FT%TZ) lighthouse-watch start reason=$REASON"
date +%s > "$STAMP"

TOKEN="$(grep -E '^LIGHTHOUSE_WATCH_TOKEN=' .env.production | cut -d= -f2- | tr -d '"' || true)"
if [ "${#TOKEN}" -lt 32 ]; then echo "STOP: LIGHTHOUSE_WATCH_TOKEN missing from .env.production"; exit 1; fi
# Results are posted to the API over the compose network, not the public host:
# Cloudflare answers a non-browser POST to api.shopgoldplus.com with 403.
API="${LIGHTHOUSE_WATCH_API:-http://api:3000}"
NET="${LIGHTHOUSE_WATCH_NETWORK:-goldplus-commerce_default}"
URLS="${LIGHTHOUSE_WATCH_URLS:-https://shopgoldplus.com/ https://shopgoldplus.com/shop}"
IMAGE="${LIGHTHOUSE_WATCH_IMAGE:-mcr.microsoft.com/playwright:v1.61.1-noble}"

WORK="$(mktemp -d /tmp/lighthouse-watch.XXXXXX)"; trap 'rm -rf "$WORK"' EXIT
cp scripts/lighthouse-watch/run.mjs "$WORK/run.mjs"

# --cpus keeps a 2-core host responsive for customers while the audit runs.
# The npm cache volume keeps the lighthouse download to the first run only.
docker run --rm --cpus=1.5 --memory=1500m --shm-size=512m --network "$NET" \
  -v "$WORK:/work" -v lighthouse-watch-npm:/root/.npm \
  -e URLS="$URLS" -e API="$API" -e TOKEN="$TOKEN" -e REASON="$REASON" \
  --entrypoint bash "$IMAGE" -c '
    set -e
    CHROME="$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -1)"
    export CHROME_PATH="$CHROME"   # chrome-launcher reads the env var; the CLI flag is not enough
    cd /work
    for URL in $URLS; do
      SLUG="$(echo "$URL" | sed -E "s#https?://##; s#[^A-Za-z0-9]+#_#g")"
      for FF in mobile desktop; do
        if [ "$FF" = mobile ]; then FLAGS="--form-factor=mobile --screenEmulation.mobile --throttling-method=simulate"; else FLAGS="--preset=desktop"; fi
        npx -y lighthouse@12 "$URL" $FLAGS --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage" \
          --output=json --output-path="/work/$SLUG.$FF.json" --quiet || echo "lighthouse failed for $URL $FF"
      done
    done
    node /work/run.mjs
  '
echo "=== $(date -u +%FT%TZ) lighthouse-watch end"
