#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/scripts/common.sh"
export COMPAT_MODE=low-end
pw journeys network mobile --project 'chromium:small_low_end_android'
finish_reports
exit 0
