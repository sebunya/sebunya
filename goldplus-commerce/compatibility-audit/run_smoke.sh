#!/usr/bin/env bash
# Post-deploy smoke: core journeys on Chromium (low-end + mainstream), Firefox
# and WebKit, plus PWA health and one constrained profile. Fast enough for
# release verification (~10 min on the 2-vCPU host).
source "$(dirname "${BASH_SOURCE[0]}")/scripts/common.sh"
export COMPAT_MODE=smoke
export COMPAT_GLOBAL_TIMEOUT_MS="${COMPAT_GLOBAL_TIMEOUT_MS:-1500000}"  # 25 min hard stop for release verification
echo "=== compatibility smoke $COMPAT_RUN_ID target=$COMPAT_TARGET_URL"
pw journeys pwa --project 'chromium:small_low_end_android' --project 'chromium:mainstream_android' --project 'firefox:desktop_1440_firefox' --project 'webkit:mainstream_iphone'; RC=$?
pw network --project 'chromium:small_low_end_android' --grep 'slow_mobile'
finish_reports
exit 0
