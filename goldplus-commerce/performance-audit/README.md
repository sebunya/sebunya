# GoldPlus Continuous Performance Assurance

A rolling ten-day, fourteen-provider audit of shopgoldplus.com: synthetic
performance, multi-region TTFB, security headers, code quality, a read-only
load canary, and a regression engine with a durable schedule. It measures and
reports; it never changes the storefront, never pays, never places an order.

## Safety contract (non-negotiable)

- Heavy load (k6 ramp, Artillery journey, Loader.io) runs **only** against
  `LOAD_TARGET_URL`. If that is the production host, BOTH
  `ALLOW_PROD_LOAD_TEST=true` and
  `PROD_LOAD_TEST_ACK=I_UNDERSTAND_THIS_GENERATES_REAL_TRAFFIC` must be present,
  otherwise the heavy providers report `SKIPPED_FOR_SAFETY` and run nothing.
  Heavy load is additionally refused when the runner is the production
  application host (`/opt/goldplus/app` present).
- The every-audit canary is 2 virtual users for 30 s doing `GET /` and
  `GET /shop`. Nothing else touches the site under load.
- Journeys stop at the checkout entry page. No payment method is selected, no
  order is placed, no refund, no inventory movement, no pricing/stock/config
  mutation. The WebPageTest flow adds one product to a synthetic visitor's cart
  and stops.
- Secrets live only in `.env` (git-ignored) or the process environment. They
  never reach `config.resolved.json`, manifests, logs or saved raw responses
  (see `lib/redact.mjs`, `lib/perf_audit_py.py`); a save that would leak a
  registered credential is refused.
- Runtime data lives under `PERF_AUDIT_DATA_DIR`
  (`/var/lib/goldplus-performance-audit` on the host), never in Git.
- Statuses are honest: an integration that is coded but has no credential is
  `IMPLEMENTED_AWAITING_CREDENTIALS`, never a success.

## Layout

```
audit.config.yaml          non-secret configuration (pages, schedule, budget, thresholds, retention)
.env.example               every secret / per-runner variable (copy to .env on the runner)
run_all.sh                 one audit: validate → flock → providers → normalize → compare → reports
run_safe_recurring.sh      the scheduler entry point (rolling 10-day gate, retries, ad-hoc, status)
compare_runs.py            regression engine → normalized_metrics.json, regression.json, regression_report.md
generate_summary.py        engineering_report.md, executive_summary.md, trend_summary.md, cloudflare_comparison.md
alerts.py                  alert conditions → alerts.json, logs/alerts.log, optional webhook
retention.py               prunes old runs; never the latest success, a historical best or a *baseline run
provider_status.json       the provider matrix (status, API, credentials) — snapshotted into every run
lib/                       config, http (bounded retries), redact, state (scheduler), normalize, provider harness
schedule/                  run-in-container.sh, install_schedule.sh, status.sh, uninstall_schedule.sh
tests/                     node:test + unittest + static checks
<provider files>           one runner per provider, see provider_status.json
```

## Providers

| Provider | Runner | Status today |
|---|---|---|
| Control measurements (curl timings, TLS, protocol, compression, headers, byte breakdown) | `control_measurements.js` | IMPLEMENTED_AND_VERIFIED |
| WebPageTest desktop + mobile | `webpagetest_runner.js` | IMPLEMENTED_AWAITING_CREDENTIALS |
| WebPageTest e-commerce flow | `wpt_ecommerce_flow.js` + `.txt` | IMPLEMENTED_AWAITING_CREDENTIALS |
| GTmetrix API 2.0 | `gtmetrix_runner.py` | IMPLEMENTED_AWAITING_CREDENTIALS |
| DebugBear Quick Tests | `debugbear_audit.sh` | IMPLEMENTED_AWAITING_CREDENTIALS |
| SpeedVitals multi-region TTFB | `speedvitals_test.js` | IMPLEMENTED_AWAITING_CREDENTIALS |
| Pingdom | `pingdom_audit.js` | BLOCKED_BY_PROVIDER (free tool has no API) |
| Yellow Lab Tools | `yellowlab_audit.js` | IMPLEMENTED_AND_VERIFIED |
| KeyCDN Performance Test | `keycdn_check.py` | UNSUPPORTED_BY_CURRENT_PROVIDER (no API; not scraped) |
| k6 canary / checkout stress | `run_k6.sh` | IMPLEMENTED_AND_VERIFIED (canary); heavy SKIPPED_FOR_SAFETY |
| Artillery journey | `run_artillery.sh` | SKIPPED_FOR_SAFETY until a safe load target exists |
| Loader.io | `loaderio_setup.js` | IMPLEMENTED_AWAITING_CREDENTIALS |
| SpeedCurve | `speedcurve_analytics.js` | IMPLEMENTED_AWAITING_SUBSCRIPTION |
| Mozilla Observatory v2 | `mozilla_observatory.py` | IMPLEMENTED_AND_VERIFIED |
| webhint | `run_webhint.sh` + `.hintrc` | IMPLEMENTED_AND_VERIFIED (where the optional dependency installs) |
| Lighthouse 12 local (3-run medians, mobile simulated + desktop) | `lighthouse_local.mjs` | IMPLEMENTED_AND_VERIFIED — the performance golden-master guard |
| Compatibility programme (`../compatibility-audit`: engines, constrained profiles, data usage, PWA, a11y, visual) | `run_compatibility.sh` | IMPLEMENTED_AND_VERIFIED (real devices AWAITING_CREDENTIALS) |

Every provider writes `status.json`, `normalized.json`, and where available
`raw.json` (redacted) and `summary.md` into `providers/<name>/` of the run.
`raw.json` for the control measurement includes the Pingdom-style content-type
breakdown labelled as control data, because Pingdom itself cannot be automated.

## Run outputs

`$PERF_AUDIT_DATA_DIR/reports/<run_id>/`

- `manifest.json` — run id, kind (recurring | ad-hoc), label, repo sha, target, outcome, provider statuses
- `normalized_metrics.json` — every metric in the shared schema (`schemas/normalized_metrics.schema.json`)
- `regression.json` + `regression_report.md` — per-cell comparison with the previous successful run, the historical best and the budget
- `engineering_report.md` — the twelve key questions answered from data, with attribution hints
- `executive_summary.md` — the non-technical view
- `trend_summary.md` — the key cells across every stored run
- `cloudflare_comparison.md` — only when the run label starts with `post-cloudflare` and a `pre-cloudflare-baseline` run exists
- `alerts.json` — recurring runs only
- `provider_status.snapshot.json`, `providers/<name>/...`, and the log at `logs/<run_id>.log`

## Scheduler

State: `$PERF_AUDIT_DATA_DIR/state/schedule.json` with `last_attempt_at`,
`last_success_at`, `last_success_run_id`, `next_due_at`, `retry_count`,
`cycle_failed`, `history`. Written atomically (temp file + rename); a corrupt
file is moved aside and never trusted.

- A recurring audit is due `864000` seconds after the last successful one
  (rolling; never "every 10th calendar day").
- A failed cycle retries at +6 h, +12 h, +24 h after the failed attempt, then
  waits a full interval. Never hourly.
- Ad-hoc runs (`--ad-hoc`) never touch the state, so they never reset the clock.
- The systemd timer fires daily at 02:40 UTC with `Persistent=true`; the
  script exits immediately when nothing is due. An audit missed because the
  host was off runs at the first tick after recovery.
- `flock` on `locks/audit.lock` makes concurrent runs impossible (exit 75).

```
schedule/install_schedule.sh          # root; installs goldplus-performance-audit.timer/.service
schedule/status.sh                    # timer, state, latest run, disk
schedule/run-in-container.sh --status # scheduler state as JSON
schedule/run-in-container.sh --ad-hoc --label my-check
schedule/run-in-container.sh --force --label pre-cloudflare-baseline   # recurring now; advances the clock
schedule/uninstall_schedule.sh        # removes the units; keeps history
```

The runner is the Playwright image already present on the host
(`mcr.microsoft.com/playwright:v1.61.1-noble`: node, python3, Chromium). The
host itself has no node. `run-in-container.sh` mounts the checkout read-only,
the data dir, and the docker socket (the k6 canary runs as a sibling
container from `grafana/k6:1.8.1`).

## Back office (admin) view and one-click runs

`/admin/seo/performance-audit` (permission `seo.view`; requesting a run needs
`seo.audit.run`) shows the scheduler health, the latest run's key cells,
provider statuses, movements beyond noise, the provider matrix, and the run
history. "Queue the run" writes `requests/queue/<id>.json`; the host path unit
`goldplus-performance-audit-request.path` drains the queue through
`schedule/process-requests.sh`, which runs the same container runner. The API
never runs the audit and never touches Docker. Limits: one request in flight,
six back-office runs per rolling 24 h (API and host both enforce it), reserved
baseline label refused, heavy load impossible from this path.

The API container reads the data directory through a bind mount
(`PERFORMANCE_AUDIT_DATA_DIR`, see `docker-compose.production.yml`). Without
the mount the page says NOT CONFIGURED and reports stay host-only.

## Admin-managed settings (no terminal after launch)

`/admin/seo/performance-audit/settings` edits everything the runner reads:
targets and the test product, a staging load host, pages, the interval (1–30
days), providers on/off, canary size (bounded 1–3 users, 10–60 s), budgets,
regression thresholds, retention, provider credentials and the alert webhook.
The API writes `settings/config.overrides.json` (non-secret) and
`settings/secrets.env` (mode 600, owned by the API user) into the data
directory. Precedence, lowest to highest:

```
audit.config.yaml  <  performance-audit/.env  <  admin settings  <  process environment
```

`lib/config.mjs` (`readAdminSettings`), `lib/env.sh` (`load_admin_settings`)
and `lib/perf_audit_py.py` all apply the same layering, so the shell path and
the scheduler see exactly what the admin saved. A malformed overrides file is
ignored with a reason (logged in the run and shown on the settings page), never
half-applied. The runner snapshots its secret-free effective configuration to
`state/config.effective.json` on every run and tick; the settings page shows
those values as the defaults. Deliberately not editable from the browser:
`ALLOW_PROD_LOAD_TEST` and `PROD_LOAD_TEST_ACK` — heavy load against the
production host stays a terminal-only, two-value decision, and the settings
validator refuses a `LOAD_TARGET_URL` on the production host.

## Local development

```
npm install            # js-yaml, webpagetest, optional hint
npm run check          # syntax of every file, config parse, safety invariants
npm test               # node:test + unittest
PERF_AUDIT_DATA_DIR=/tmp/pa ./run_all.sh --label local-check
```

## Alerts

`alerts.py` records `AUDIT_FAILED`, `NO_SUCCESS_12_DAYS`,
`CYCLE_FAILED_RETRIES_EXHAUSTED`, `AVAILABILITY_FAILURE`,
`SECURITY_REGRESSION`, `LCP_REGRESSION`, `TTFB_REGRESSION`,
`ERROR_RATE_REGRESSION`, `LOAD_SLA_FAILURE` into `alerts.json` and
`logs/alerts.log`. When `PERF_AUDIT_ALERT_WEBHOOK_URL` is set, the same JSON is
POSTed there. No channel is invented: connect a webhook (Slack incoming
webhook, an email bridge, or the GoldPlus API) and the alert arrives; until
then, `schedule/status.sh` and the log are the surface.

## Test product

`AUDIT_PRODUCT_URL` (for the WebPageTest flow and the Artillery journey)
should be a product that stays published. Choose one from the live shop; the
flow adds it to a synthetic cart and never orders it.

## Owner actions to unlock more providers

Add the credential to `performance-audit/.env` on the host; the next run picks
it up. `WPT_API_KEY`, `GTMETRIX_API_KEY`, `DEBUGBEAR_API_KEY` +
`DEBUGBEAR_PROJECT_ID`, `SPEEDVITALS_API_KEY`, `LOADERIO_API_KEY` +
`LOADERIO_VERIFICATION_TOKEN`, `SPEEDCURVE_API_KEY`, `PINGDOM_API_TOKEN`
(paid), `LOAD_TARGET_URL` (a staging host; heavy load stays off production),
`PERF_AUDIT_ALERT_WEBHOOK_URL`.
