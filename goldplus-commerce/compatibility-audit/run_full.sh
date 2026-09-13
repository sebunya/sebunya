#!/usr/bin/env bash
# The full programme: every engine/viewport class, constrained profiles, data
# usage, PWA, accessibility, visual baselines, real devices (if credentialed).
source "$(dirname "${BASH_SOURCE[0]}")/scripts/common.sh"
export COMPAT_MODE=full
echo "=== compatibility full run $COMPAT_RUN_ID target=$COMPAT_TARGET_URL out=$COMPAT_OUT_DIR"
pw; RC=$?
finish_reports
exit 0   # provider status is decided from the manifest, not the exit code
