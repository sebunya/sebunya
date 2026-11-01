#!/usr/bin/env bash
# Tell the owner that a GoldPlus job failed. Called by goldplus-alert@.service,
# which every GoldPlus timer job names in OnFailure=.
#
#   ops/backup/alert.sh <failed-unit-name>
#
# Posts one line, with the unit's last journal lines, to ALERT_WEBHOOK_URL (an
# ntfy topic, or a Slack/Discord webhook) from /etc/goldplus/secrets/alerts.env.
# This used to be a one-liner inside the unit file, where systemd expands "$"
# itself: $(journalctl ...) never reached the shell, and "test && curl || echo"
# reported a failed send as "no URL". A script has neither problem.
# Exit 0 always: an alert that fails must not mark the alert unit failed and
# trigger nothing; the outcome is printed to the journal instead.
set -uo pipefail
UNIT="${1:?failed unit name}"
ENV_FILE="${ALERT_ENV_FILE:-/etc/goldplus/secrets/alerts.env}"
if [ -z "${ALERT_WEBHOOK_URL:-}" ] && [ -r "$ENV_FILE" ]; then
  ALERT_WEBHOOK_URL="$(grep -E '^ALERT_WEBHOOK_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"'" | tr -d '[:space:]')"
fi
TAIL="$(journalctl -u "$UNIT" -n 5 --no-pager -o cat 2>/dev/null | tail -c 400)"
MSG="[goldplus-prod CRITICAL] $UNIT failed${TAIL:+: $TAIL}"
if [ -z "${ALERT_WEBHOOK_URL:-}" ]; then
  echo "NOT SENT (no ALERT_WEBHOOK_URL in $ENV_FILE): $MSG"
  exit 0
fi
if curl -fsS -m 10 -H "Title: GoldPlus job failed" -H "Priority: high" -H "Content-Type: text/plain" \
     --data-binary "$MSG" "$ALERT_WEBHOOK_URL" >/dev/null; then
  echo "SENT: $MSG"
else
  echo "SEND FAILED (webhook unreachable or refused): $MSG"
fi
exit 0
