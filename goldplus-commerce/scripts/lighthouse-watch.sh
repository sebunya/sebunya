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
# Scheduling (owner decisions 2026-10-06; was "at most every 96 h", 2026-09-13):
# WEEKLY, Sunday 03:00 Kampala time, from the systemd timer
# ops/lighthouse-watch/goldplus-lighthouse-watch.timer (OnCalendar in
# Africa/Kampala, so no UTC arithmetic). A failure posts to the owner through
# goldplus-alert@; the API raises LIGHTHOUSE_STALE when no run has landed for
# 8 days. Deploys no longer call it: they reset the clock and moved the weekly
# run to the deploy's hour; every deploy runs Lighthouse in its own smoke.
# The 24 h guard below only stops a duplicate in the same night (a week-long
# guard skipped the first Sunday after any earlier run). `manual` bypasses it.
# Each URL x form factor is measured RUNS times (default 3) and the median kept.
set -euo pipefail
cd "$(dirname "$0")/.."
REASON="${1:-manual}"
LOG_DIR="${LIGHTHOUSE_WATCH_LOG_DIR:-/var/log/goldplus}"; mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR=/tmp
LOG="$LOG_DIR/lighthouse-watch.log"
STAMP="$LOG_DIR/lighthouse-watch.last-run"
MIN_HOURS="${LIGHTHOUSE_WATCH_MIN_INTERVAL_HOURS:-24}"
# Both the log file (history) and stdout (the systemd journal, which is what
# the failure alert quotes). Before, only the file got it and an alert said
# nothing but the unit name.
exec > >(tee -a "$LOG") 2>&1
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
cp scripts/lighthouse-watch/run.mjs scripts/lighthouse-watch/median.mjs "$WORK/"
# Runs per URL x form factor; run.mjs keeps the median (see median.mjs).
RUNS="${LIGHTHOUSE_WATCH_RUNS:-3}"

# --cpus keeps a 2-core host responsive for customers while the audit runs.
# The npm cache volume keeps the lighthouse download to the first run only.
docker run --rm --cpus=1.5 --memory=1500m --shm-size=512m --network "$NET" \
  -v "$WORK:/work" -v lighthouse-watch-npm:/root/.npm \
  -e URLS="$URLS" -e API="$API" -e TOKEN="$TOKEN" -e REASON="$REASON" -e RUNS="$RUNS" \
  --entrypoint bash "$IMAGE" -c '
    set -e
    CHROME="$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -1)"
    UA_MOBILE="Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36 GoldPlusSyntheticProbe"
    UA_DESKTOP="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 GoldPlusSyntheticProbe"
    export CHROME_PATH="$CHROME"   # chrome-launcher reads the env var; the CLI flag is not enough
    cd /work
    for URL in $URLS; do
      SLUG="$(echo "$URL" | sed -E "s#https?://##; s#[^A-Za-z0-9]+#_#g")"
      for FF in mobile desktop; do
        if [ "$FF" = mobile ]; then FLAGS="--form-factor=mobile --screenEmulation.mobile --throttling-method=simulate"; else FLAGS="--preset=desktop"; fi
        # The probe names itself in the user agent. Lighthouse EMULATES a plain
        # mobile/desktop Chrome (overriding whatever agent the browser would
        # send, so a Chrome flag does not survive) and drives it over CDP, where
        # navigator.webdriver is false. Without this, a monitor running once a
        # minute reads as a very loyal visitor who never buys, and quietly
        # enters the attribution models. The token is appended to the default
        # Lighthouse agent, so form-factor detection is unchanged.
        UA="$UA_MOBILE"; [ "$FF" = desktop ] && UA="$UA_DESKTOP"
        for N in $(seq 1 "$RUNS"); do
          npx -y lighthouse@12 "$URL" $FLAGS --emulatedUserAgent="$UA" --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage" \
            --output=json --output-path="/work/$SLUG.$FF.$N.json" --quiet || echo "lighthouse failed for $URL $FF run $N"
        done
      done
    done
    node /work/run.mjs
  '
echo "=== $(date -u +%FT%TZ) lighthouse-watch end"
