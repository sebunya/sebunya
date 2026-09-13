#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/scripts/common.sh"
export COMPAT_MODE=pwa
pw pwa --project 'chromium:mainstream_android' --project 'webkit:mainstream_iphone' --project 'firefox:desktop_1440_firefox'
finish_reports
exit 0
