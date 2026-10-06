#!/usr/bin/env bash
# One-screen health report of the production host. Runs ON the host, as root.
# Read-only: it changes nothing.
#
#   scripts/host-maintain.sh
#
# Reclamation is NOT done here. The Storage Steward owns it
# (ops/storage-steward, timers goldplus-storage-{observer,housekeeper,deep}):
# build cache to its policy bound, Docker log caps, journald, audit results,
# and backup expiry — which it refuses until a verified remote exists (rule 4:
# a copy on the same disk as production is not resilience). The nightly job
# (ops/backup/pg-backup.sh) keeps KEEP_DAYS of nightly sets itself.
#
# 2026-10-06: a first version of this file deleted backups by its own rule and
# pruned Docker by another; it would have fought the Steward over the same
# directory and broken rule 4. Two cleaners on one folder is worse than none.
set -euo pipefail
have() { command -v "$1" >/dev/null 2>&1; }
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; }
BACKUPS="${BACKUP_DIR:-/root/goldplus-db-backups}"
STEWARD="${STEWARD_BIN:-/usr/local/sbin/goldplus-storage-steward}"

echo "=== host report $(date -u +%FT%TZ)"
echo "--- disk";  df -h / | tail -1
have free && { echo "--- memory"; free -h | sed -n '2,3p'; }
if have docker; then
  echo "--- docker (SIZE counts shared layers more than once; RECLAIMABLE is the honest column)"
  docker system df 2>/dev/null || true
  echo "--- containers not from the compose project (audits, migrators, rehearsals)"
  docker ps --format '{{.Names}}\t{{.Status}}' | grep -v '^goldplus-commerce-' || echo "  none"
fi
if [ -d "$BACKUPS" ]; then
  echo "--- backups in $BACKUPS ($(du -sh "$BACKUPS" 2>/dev/null | cut -f1))"
  newest=$(ls -1t "$BACKUPS"/nightly/goldplus-prod-nightly-*.dump 2>/dev/null | head -1 || true)
  if [ -n "$newest" ]; then
    age_h=$(( ( $(date +%s) - $(mtime "$newest") ) / 3600 ))
    echo "  newest nightly dump: $(basename "$newest"), ${age_h}h old$([ "$age_h" -gt 30 ] && echo '   <-- STALE: goldplus-pg-backup.timer did not run')"
  else
    echo "  NO nightly dump found   <-- goldplus-pg-backup.timer is missing or failing"
  fi
  echo "  nightly sets: $(ls "$BACKUPS"/nightly/goldplus-prod-nightly-*.dump 2>/dev/null | wc -l | tr -d ' ')   pre-migration dumps: $(ls "$BACKUPS"/goldplus-prod-pre-*.dump 2>/dev/null | wc -l | tr -d ' ')"
  find "$BACKUPS" -maxdepth 2 -type f -size 0 -mmin +60 2>/dev/null | sed 's/^/  EMPTY file (not a backup): /'
  echo "  offsite copy: $([ -s "$BACKUPS/.offsite-target" ] && cat "$BACKUPS/.offsite-target" || echo 'NONE — every backup is on the database'"'"'s own disk; the Steward will not expire any until this exists')"
fi
if [ -x "$STEWARD" ]; then
  echo "--- storage steward"; "$STEWARD" status 2>&1 | head -5 || true
  have systemctl && systemctl list-timers --all --no-pager 2>/dev/null | grep -i goldplus | awk '{print "  " $0}' || true
else
  echo "--- storage steward: NOT INSTALLED at $STEWARD (ops/storage-steward/README.md)"
fi
