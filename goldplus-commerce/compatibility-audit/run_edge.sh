#!/usr/bin/env bash
# The EDGE pass: a small, low-volume set through Cloudflare (the real customer
# path) — early interaction (Rocket Loader), data usage cold/warm, PWA manifest /
# service worker / offline. Kept small because Cloudflare challenges headless
# traffic from the host at volume; the full matrix runs through the origin
# (run_full.sh in a sibling container, see performance-audit/run_compatibility.sh).
source "$(dirname "${BASH_SOURCE[0]}")/scripts/common.sh"
export COMPAT_MODE="${COMPAT_MODE:-full}" COMPAT_PASS=edge COMPAT_PATH=edge
echo "=== compatibility edge pass $COMPAT_RUN_ID target=$COMPAT_TARGET_URL"
pw browser data-usage pwa --project 'chromium:mainstream_android'
exit 0   # reports are generated after the origin pass
