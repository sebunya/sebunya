# Lighthouse Watch schedule

Weekly, **Sunday 03:00 Kampala time**, by systemd (owner decisions 2026-10-06).
Each of `/` and `/shop`, mobile and desktop, is measured three times and the
median run is kept. A failed run alerts the owner through `goldplus-alert@`;
the API raises `LIGHTHOUSE_STALE` if no measurement lands for 8 days.

## Install (once, replaces the old cron file)

    sudo rm -f /etc/cron.d/goldplus-lighthouse-watch
    sudo cp ops/lighthouse-watch/goldplus-lighthouse-watch.{service,timer} ops/backup/goldplus-alert@.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now goldplus-lighthouse-watch.timer
    systemctl list-timers goldplus-lighthouse-watch.timer   # NEXT shows Sun 00:00 UTC

The old cron file MUST go: left in place, it would keep firing the watch every
day at 03:17 UTC (06:17 Kampala, the morning rush), and the 24 h guard would let
every one of those through.

## Run now

    sudo systemctl start goldplus-lighthouse-watch.service      # through systemd, alerts on failure
    ./scripts/lighthouse-watch.sh manual                        # directly, bypasses the 24 h guard
    tail -40 /var/log/goldplus/lighthouse-watch.log
