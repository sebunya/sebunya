#!/usr/bin/env bash
# Copy every local backup to a remote that survives this machine, then PROVE
# the copy. Runs ON the host, after the nightly backup.
#
#   ops/backup/offsite-sync.sh            # sync + verify
#   ops/backup/offsite-sync.sh --verify   # verify only (no transfer)
#
# Why: since 2026-09-12 every recovery point has lived on the same disk as the
# database. The Storage Steward (rule 4) rightly refuses to expire local dumps
# until a VERIFIED remote exists, so the local set only grows. This is the
# remote. Design choice: rsync over ssh to a Hetzner Storage Box with a
# dedicated key — no passphrase that, if lost, loses every backup (restic's
# failure mode), and the proof of a copy is a plain listing on the far side.
#
# Target: one line in $TARGET_FILE, e.g.
#   u123456-sub1@u123456.your-storagebox.de:goldplus-backups
# (sub-account with its own key, restricted to its own directory; port 23).
#
# Never removes anything on the remote: retention there is the Storage Box's
# own snapshots plus, later, the Steward's remote-aware retention.
#
# On success writes $VERIFIED_FILE with the UTC time and the count of files
# proven present and same-sized. The Storage Steward treats a marker younger
# than 48 h as "verified remote" (see goldplus-storage-steward: remote_verified).
set -euo pipefail

BACKUPS="${BACKUP_DIR:-/root/goldplus-db-backups}"
TARGET_FILE="${OFFSITE_TARGET_FILE:-$BACKUPS/.offsite-target}"
VERIFIED_FILE="${OFFSITE_VERIFIED_FILE:-$BACKUPS/.offsite-verified-at}"
SSH_KEY="${OFFSITE_SSH_KEY:-/etc/goldplus/secrets/offsite_ed25519}"
SSH_PORT="${OFFSITE_SSH_PORT:-23}"
LOCAL_ONLY="${OFFSITE_LOCAL_ONLY:-}"       # tests: a local directory as the "remote"
MODE="${1:-sync}"

[ -d "$BACKUPS" ] || { echo "STOP: no backup directory $BACKUPS"; exit 1; }
[ -s "$TARGET_FILE" ] || { echo "STOP: $TARGET_FILE is missing or empty. Put the remote (user@host:dir) in it first."; exit 1; }
TARGET="$(head -1 "$TARGET_FILE" | tr -d '[:space:]')"

# Only real backups travel: dumps and media archives, never state files or
# the Steward's database. Same-sized on both ends = proven.
list_local() { ( cd "$BACKUPS" && find . -type f \( -name '*.dump' -o -name '*.tar.gz' \) -printf '%s %P\n' 2>/dev/null \
  || find . -type f \( -name '*.dump' -o -name '*.tar.gz' \) -exec stat -f '%z %N' {} \; | sed 's# \./# #' ) | sort -k2; }

# rsync --list-only prints "-rw-r--r--  159,799,130 2026/10/06 02:16:01 nightly/x.dump";
# directories come as "drwx------ ... nightly" with NO trailing slash, so the
# first character decides, not the name. Sizes may carry thousands separators.
parse_rsync_listing() { awk '/^-/ { gsub(",", "", $2); print $2, $NF }' | sort -k2; }

if [ -n "$LOCAL_ONLY" ]; then
  RSYNC_DEST="$LOCAL_ONLY/"
  RSYNC_E=()
  list_remote() { rsync -r --list-only --include='*/' --include='*.dump' --include='*.tar.gz' --exclude='*' "$RSYNC_DEST" | parse_rsync_listing; }
else
  [ -r "$SSH_KEY" ] || { echo "STOP: ssh key $SSH_KEY not readable"; exit 1; }
  RSYNC_DEST="$TARGET/"
  RSYNC_E=(-e "ssh -p $SSH_PORT -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new")
  REMOTE_HOST="${TARGET%%:*}"; REMOTE_DIR="${TARGET#*:}"
  # Storage Boxes offer sftp/rsync, not a shell: list through rsync itself.
  list_remote() { rsync ${RSYNC_E[@]+"${RSYNC_E[@]}"} -r --list-only --include='*/' --include='*.dump' --include='*.tar.gz' --exclude='*' "$RSYNC_DEST" | parse_rsync_listing; }
fi

if [ "$MODE" = "sync" ]; then
  echo "=== offsite sync $(date -u +%FT%TZ) → $TARGET"
  # -a keeps times for the far side's retention; --ignore-existing never
  # rewrites a file already there (a backup is immutable once taken);
  # --partial-dir survives a dropped link. Plain --partial left the cut-off
  # file under its final name, which --ignore-existing then skipped forever:
  # a truncated dump offsite and a verify failure every night, never repaired.
  # Nothing on the far side is ever removed.
  rsync -a --ignore-existing --partial-dir=.rsync-partial --timeout=600 \
    --include='*/' --include='*.dump' --include='*.tar.gz' --exclude='*' \
    ${RSYNC_E[@]+"${RSYNC_E[@]}"} "$BACKUPS/" "$RSYNC_DEST"
fi

echo "--- verify"
LOCAL=$(list_local); REMOTE=$(list_remote)
MISSING=$(comm -23 <(printf '%s\n' "$LOCAL") <(printf '%s\n' "$REMOTE") | awk '{print $2 " (" $1 " bytes locally)"}')
if [ -n "$MISSING" ]; then
  echo "FAIL: not on the remote, or a different size there:"; printf '  %s\n' $MISSING
  rm -f "$VERIFIED_FILE"
  exit 2
fi
COUNT=$(printf '%s\n' "$LOCAL" | grep -c . || true)
printf '%s files=%s target=%s\n' "$(date -u +%FT%TZ)" "$COUNT" "$TARGET" > "$VERIFIED_FILE"
echo "OK: $COUNT backup files present and same-sized on $TARGET; marker $VERIFIED_FILE"
