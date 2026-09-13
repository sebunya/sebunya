#!/usr/bin/env bash
# Removes the systemd timer + service. Data under PERF_AUDIT_DATA_DIR is kept
# (delete it deliberately if you want the history gone).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
systemctl disable --now goldplus-performance-audit.timer goldplus-performance-audit-request.path 2>/dev/null || true
rm -f /etc/systemd/system/goldplus-performance-audit.timer /etc/systemd/system/goldplus-performance-audit.service /etc/systemd/system/goldplus-performance-audit-request.path /etc/systemd/system/goldplus-performance-audit-request.service
systemctl daemon-reload
echo "uninstalled: goldplus-performance-audit.timer/.service (history kept under ${PERF_AUDIT_DATA_DIR:-/var/lib/goldplus-performance-audit})"
