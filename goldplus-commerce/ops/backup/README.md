# Nightly database + media backup, and the offsite copy

Three timers. The first makes the backup, the second moves it off the machine
and proves it arrived, the third proves it can become a working database again.
All are installed ON the production host (owner action). Any failure posts to
the owner through `goldplus-alert@.service` → `ops/backup/alert.sh` (ALERT_WEBHOOK_URL).

    02:15 UTC       goldplus-pg-backup.timer      ops/backup/pg-backup.sh       dump + media tar, kept 14 days locally
    02:50 UTC       goldplus-offsite-sync.timer   ops/backup/offsite-sync.sh    rsync to the Storage Box, then verify
    1st Sun 03:30   goldplus-restore-drill.timer  ops/backup/restore-drill.sh   pull newest dump from the Box, restore, compare with live

## What already exists, and what this adds (corrected 2026-10-06)

Hetzner's own daily **server backups are enabled** on the production server (7 kept, 02:36 UTC), and
each image contains that night's 02:15 dump. They are stored by Hetzner, not on the server's disk.
Their gap: Hetzner deletes them **together with the server**, and they live in the same account.
The Storage Box copy below survives a deleted server; turning on the server's delete protection in
the Hetzner Console closes most of that gap for free.

## Install (once)

    sudo cp ops/backup/goldplus-{pg-backup,offsite-sync,restore-drill}.{service,timer} ops/backup/goldplus-alert@.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now goldplus-pg-backup.timer goldplus-offsite-sync.timer goldplus-restore-drill.timer
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

## Restore drill (the only proof that counts)

    sudo ops/backup/restore-drill.sh            # from the Storage Box
    sudo ops/backup/restore-drill.sh --local    # from this disk

Ends with `DRILL OK: … restores to N tables; the five largest tables are within
0.90 of live`, and writes the result to
`/var/lib/goldplus-storage-steward/restore-drill.json`. Run it once by hand the
day the Storage Box is set up.

## Restore

`scripts/migrate-prod.sh` already restores a dump into an ephemeral postgres on
a private network as its rehearsal; the same `pg_restore` applies to any file
here or on the Storage Box. Media: untar the archive into the
`goldplus-commerce_media_uploads` volume.
