#!/usr/bin/env bash
# Installs the durable scheduler on the persistent GoldPlus host as a systemd
# timer + service (the host already schedules goldplus-pg-backup.timer the
# same way). The timer fires DAILY; the audit itself runs only when the rolling
# ten-day gate in lib/state.mjs says it is due, so real audits stay ten days
# apart, an overdue audit runs at the first daily tick after recovery, and a
# reboot loses nothing (Persistent=true catches a missed tick).
# Idempotent and reversible (see uninstall_schedule.sh).
set -euo pipefail
AUDIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${PERF_AUDIT_DATA_DIR:-/var/lib/goldplus-performance-audit}"
[ "$(id -u)" = 0 ] || { echo "run as root (systemd units)"; exit 1; }
command -v docker >/dev/null || { echo "docker is required on the runner"; exit 1; }
[ -f "$AUDIT_DIR/.env" ] || echo "note: $AUDIT_DIR/.env is missing — providers without credentials will report IMPLEMENTED_AWAITING_CREDENTIALS"
# The admin API container reads this tree (bind-mounted, uid 1000) and writes ONLY into
# requests/queue: reports are world-readable (they carry no secrets; raw responses are
# redacted on write), the queue is sticky-world-writable, everything else stays root's.
mkdir -p "$DATA_DIR"/{reports,state,logs,locks,requests/queue,requests/processing,requests/done}
chmod 755 "$DATA_DIR" "$DATA_DIR"/{reports,state,logs,requests,requests/processing,requests/done}; chmod 700 "$DATA_DIR/locks"; chmod 1777 "$DATA_DIR/requests/queue"
# settings/: written by the API (uid 1000 in the api container) — credentials live here with mode 600.
install -d -m 700 -o "${PERF_AUDIT_API_UID:-1000}" -g "${PERF_AUDIT_API_GID:-1000}" "$DATA_DIR/settings"
cat > /etc/systemd/system/goldplus-performance-audit.service <<EOF
[Unit]
Description=GoldPlus Continuous Performance Assurance (runs only when the rolling 10-day gate is due)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$AUDIT_DIR
Environment=PERF_AUDIT_DATA_DIR=$DATA_DIR
ExecStart=$AUDIT_DIR/schedule/run-in-container.sh
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=4h
EOF
cat > /etc/systemd/system/goldplus-performance-audit.timer <<'EOF'
[Unit]
Description=Daily due-check for the GoldPlus performance audit (audits themselves are 10 days apart)

[Timer]
OnCalendar=*-*-* 02:40:00 UTC
Persistent=true
RandomizedDelaySec=900

[Install]
WantedBy=timers.target
EOF
# Back-office requests: a path unit watches requests/queue and drains it through process-requests.sh.
cat > /etc/systemd/system/goldplus-performance-audit-request.service <<EOF
[Unit]
Description=GoldPlus performance audit — run requests queued from the admin back office
After=docker.service network-online.target

[Service]
Type=oneshot
WorkingDirectory=$AUDIT_DIR
Environment=PERF_AUDIT_DATA_DIR=$DATA_DIR
ExecStart=$AUDIT_DIR/schedule/process-requests.sh
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=4h
EOF
cat > /etc/systemd/system/goldplus-performance-audit-request.path <<EOF
[Unit]
Description=Watch the performance-audit request queue written by the admin API

[Path]
DirectoryNotEmpty=$DATA_DIR/requests/queue
Unit=goldplus-performance-audit-request.service

[Install]
WantedBy=multi-user.target
EOF
chmod +x "$AUDIT_DIR"/schedule/*.sh "$AUDIT_DIR"/*.sh 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now goldplus-performance-audit.timer
systemctl enable --now goldplus-performance-audit-request.path
echo "installed: goldplus-performance-audit-request.path (drains $DATA_DIR/requests/queue)"
echo "installed: goldplus-performance-audit.timer (daily 02:40 UTC due-check; Persistent=true)"
systemctl list-timers goldplus-performance-audit.timer --no-pager | head -3
