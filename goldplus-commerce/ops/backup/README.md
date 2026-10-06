# Nightly database + media backup, and the offsite copy

Two timers. The first makes the backup, the second moves it off the machine and
proves it arrived. Both are installed ON the production host (owner action).

    02:15 UTC  goldplus-pg-backup.timer     ops/backup/pg-backup.sh      dump + media tar, kept 14 days locally
    02:50 UTC  goldplus-offsite-sync.timer  ops/backup/offsite-sync.sh   rsync to the Storage Box, then verify

## Install (once)

    sudo cp ops/backup/goldplus-pg-backup.{service,timer} ops/backup/goldplus-offsite-sync.{service,timer} /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now goldplus-pg-backup.timer goldplus-offsite-sync.timer
    systemctl list-timers | grep goldplus

## The offsite target (once)

1. Order a Hetzner Storage Box (BX11, 1 TB, a few euros a month). In Robot:
   enable SSH, create a sub-account restricted to directory `goldplus-backups`.
2. On the host, a dedicated key, never reused:

       sudo install -d -m 0700 /etc/goldplus/secrets
       sudo ssh-keygen -t ed25519 -N "" -f /etc/goldplus/secrets/offsite_ed25519 -C goldplus-prod-offsite

   Paste `/etc/goldplus/secrets/offsite_ed25519.pub` into the sub-account's
   authorized keys in Robot (Storage Boxes take the key through the panel).
3. Name the target, then run once by hand and read the OK line:

       echo 'u123456-sub1@u123456.your-storagebox.de:goldplus-backups' | sudo tee /root/goldplus-db-backups/.offsite-target
       sudo ops/backup/offsite-sync.sh

   The run ends with `OK: N backup files present and same-sized on …` and
   writes `/root/goldplus-db-backups/.offsite-verified-at`. The Storage Steward
   reads that marker: younger than 48 h means a verified remote exists and its
   retention rules may expire old LOCAL copies. Older than 48 h means the copy
   is falling behind and nothing local is expired.
4. Turn on the Storage Box's own daily snapshots in Robot. That is the
   protection against a bad local file being copied over a good one, since the
   sync never overwrites and never deletes on the far side.

## Verify, any day

    sudo ops/backup/offsite-sync.sh --verify
    cat /root/goldplus-db-backups/.offsite-verified-at
    journalctl -u goldplus-offsite-sync.service -n 5

## Restore

`scripts/migrate-prod.sh` already restores a dump into an ephemeral postgres on
a private network as its rehearsal; the same `pg_restore` applies to any file
here or on the Storage Box. Media: untar the archive into the
`goldplus-commerce_media_uploads` volume.
