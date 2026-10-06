#!/usr/bin/env bash
# Weekly care of the production host. Runs ON the host, as root.
#
#   scripts/host-maintain.sh            # report + what WOULD be removed (dry run)
#   scripts/host-maintain.sh --apply    # report + remove it
#
# Why this exists: the disk reached 100% on 2026-09-18 (rollback images) and
# 97% on 2026-09-20 (build cache). deploy-prod.sh prunes both, but only when
# someone deploys; nightly backups, container logs, apt and journal data grew
# untouched between deploys and the host felt "almost full" again on 2026-10-06
# (42 GB used, 6.7 GB of it backups nobody had ever pruned).
#
# Rules (owner decision 2026-10-06):
#   * nightly dumps + media archives: keep the newest NIGHTLY_KEEP (7) of each,
#     plus the first set of every month for MONTHLY_KEEP (3) months
#   * pre-migration dumps (goldplus-prod-pre-*): keep the newest PREMIG_KEEP (2)
#   * never remove the newest file of any kind, whatever the rule says
#   * Docker build cache: drop layers older than BUILD_CACHE_AGE (72h); a full
#     wipe is never done here (a cold build of api+web loads the 2-vCPU host)
#   * dangling images, apt cache, journal older than JOURNAL_KEEP (14d)
#   * WARN loudly when no offsite copy of the backups is configured
set -euo pipefail

APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
BACKUPS="${BACKUP_DIR:-/root/goldplus-db-backups}"
NIGHTLY_KEEP="${NIGHTLY_KEEP:-7}"; MONTHLY_KEEP="${MONTHLY_KEEP:-3}"; PREMIG_KEEP="${PREMIG_KEEP:-2}"
BUILD_CACHE_AGE="${BUILD_CACHE_AGE:-72h}"; JOURNAL_KEEP="${JOURNAL_KEEP:-14d}"
OFFSITE_MARK="${OFFSITE_MARK:-$BACKUPS/.offsite-target}"   # file naming the rsync target, written when offsite was set up

act() { if [ "$APPLY" = 1 ]; then "$@"; else echo "  would: $*"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; }   # GNU, then BSD

echo "=== host-maintain $(date -u +%FT%TZ) mode=$([ "$APPLY" = 1 ] && echo APPLY || echo DRY-RUN)"
echo "--- disk";   df -h / | tail -1
if have free; then echo "--- memory"; free -h | sed -n '2,3p'; fi
if have docker; then echo "--- docker"; docker system df 2>/dev/null || true; fi

# ---- backups ---------------------------------------------------------------
# select_victims <dir> <pattern> <keep-newest> [monthly-keep]
# Prints the files to remove. Pure: no rm here. Works on bash 3 (macOS tests).
select_victims() {
  local dir="$1" pat="$2" keep="$3" monthly="${4:-0}"
  local candidates; candidates=$(ls -1t "$dir"/$pat 2>/dev/null | awk -v k="$keep" 'NR>k') || true
  [ -z "$candidates" ] && return 0
  if [ "$monthly" -le 0 ]; then printf '%s\n' "$candidates"; return 0; fi
  # month = first YYYYMM in the file name; candidates are newest-first, so the
  # last line seen for a month is its oldest file: that one is the keeper
  local keepers; keepers=$(printf '%s\n' "$candidates" | awk '
    { n=split($0,a,"/"); f=a[n]; if (match(f,/20[0-9][0-9][01][0-9]/)) { ym=substr(f,RSTART,6); last[ym]=$0; if (!(ym in seen)) { seen[ym]=1; order[++c]=ym } } }
    END { for (i=1;i<=c && i<='"$monthly"';i++) print last[order[i]] }')
  printf '%s\n' "$candidates" | grep -vxF -f <(printf '%s\n' "$keepers"; echo "__none__") || true
}

if [ -d "$BACKUPS" ]; then
  echo "--- backups in $BACKUPS ($(du -sh "$BACKUPS" 2>/dev/null | cut -f1))"
  newest=$(ls -1t "$BACKUPS"/nightly/goldplus-prod-nightly-*.dump 2>/dev/null | head -1 || true)
  if [ -n "$newest" ]; then
    age_h=$(( ( $(date +%s) - $(mtime "$newest") ) / 3600 ))
    echo "  newest nightly dump: $(basename "$newest"), ${age_h}h old $([ "$age_h" -gt 30 ] && echo '  <-- STALE, the nightly job did not run')"
  else
    echo "  NO nightly dump found  <-- the nightly job is missing"
  fi
  if [ -s "$OFFSITE_MARK" ]; then echo "  offsite copy: $(cat "$OFFSITE_MARK")"; else
    echo "  WARNING: no offsite copy configured ($OFFSITE_MARK absent). Every backup is on the"
    echo "           same disk as the database. Set up rsync to a Storage Box before trusting retention."
  fi
  # empty files are never a backup (older than an hour: a dump being written
  # at 02:16 is briefly zero bytes; never race the nightly job)
  find "$BACKUPS" -maxdepth 2 -type f -size 0 -mmin +60 -print | while read -r f; do act rm -f "$f"; done
  for spec in "nightly|goldplus-prod-nightly-*.dump|$NIGHTLY_KEEP|$MONTHLY_KEEP" \
              "nightly|goldplus-media-nightly-*.tar.gz|$NIGHTLY_KEEP|$MONTHLY_KEEP" \
              ".|goldplus-prod-pre-*.dump|$PREMIG_KEEP|0"; do
    IFS='|' read -r sub pat keep monthly <<< "$spec"
    while read -r f; do [ -n "$f" ] && act rm -f "$f"; done < <(select_victims "$BACKUPS/$sub" "$pat" "$keep" "$monthly")
  done
fi

# ---- docker ----------------------------------------------------------------
if have docker; then
  echo "--- docker build cache older than $BUILD_CACHE_AGE, dangling images"
  act docker builder prune -f --filter "until=$BUILD_CACHE_AGE"
  act docker image prune -f
fi

# ---- OS --------------------------------------------------------------------
echo "--- apt cache, journal older than $JOURNAL_KEEP"
have apt-get && act apt-get clean
have journalctl && act journalctl --vacuum-time="$JOURNAL_KEEP"

echo "--- after"; df -h / | tail -1
[ "$APPLY" = 1 ] || echo "(dry run: nothing was removed; re-run with --apply)"
