# Nightly database + media backup

Install ON the production host (owner action — it changes the host):

    sudo cp ops/backup/goldplus-pg-backup.{service,timer} /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now goldplus-pg-backup.timer
    sudo systemctl start goldplus-pg-backup.service   # first run, now
    systemctl list-timers | grep goldplus                # verify

Verify: `ls -l /root/goldplus-db-backups/nightly` shows a dump AND a media archive under a minute old, and
`journalctl -u goldplus-pg-backup.service` ends with `OK ...`.

Restore rehearsal is what `scripts/migrate-prod.sh` already does with a dump
(restore into an ephemeral postgres on a private network); the same `pg_restore`
applies to these files. Off-host copy of the newest dump is the next step and is
not provided here.
