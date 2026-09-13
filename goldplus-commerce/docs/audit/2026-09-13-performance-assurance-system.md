# GoldPlus Continuous Performance Assurance — delivery report (2026-09-13)

Evidence vocabulary: FOUND / REPRODUCED / FIXED / TEST VERIFIED / PUSHED / DEPLOYED / LIVE VERIFIED / OWNER ACTION / CONTENT GAP / UNRESOLVED / BOUNDED. A pushed commit is not deployed; a deployed change is not live verified.

## 1. What exists now

`performance-audit/` in the repository (commit `80c13535`, PUSHED; host checkout fast-forwarded to it, so the code is DEPLOYED on `goldplus-prod`). Runtime data lives in `/var/lib/goldplus-performance-audit` and never enters Git.

| Piece | State |
|---|---|
| 15 runners (control + 14 providers), shared normalized schema | LIVE VERIFIED (six ad-hoc smoke runs + the baseline run on the host) |
| Regression engine (`compare_runs.py`), reports (`generate_summary.py`) | LIVE VERIFIED (regression.json, 6 reports written per run) |
| Rolling 10-day scheduler (`run_safe_recurring.sh`, `lib/state.mjs`) | LIVE VERIFIED (state written; the not-due path exits with the next due time) |
| systemd timer `goldplus-performance-audit.timer` (daily 02:40 UTC, Persistent) | DEPLOYED and active; next tick 2026-09-14 02:43 UTC |
| Alerting hook (`alerts.py`) | LIVE VERIFIED (alerts.json written; no webhook configured: OWNER ACTION) |
| Retention (`retention.py`) | LIVE VERIFIED (ran; nothing to prune) |
| Tests: 11 node:test + 14 unittest + static checks | TEST VERIFIED locally (all pass) |
| README, provider_status.json, .env.example | PUSHED |

## 2. Provider matrix (live statuses from the baseline run)

| Provider | Status | Evidence / reason |
|---|---|---|
| Control (edge curl + Chromium browser probe + origin probe) | IMPLEMENTED_AND_VERIFIED | browser: home TTFB 232 ms, LCP 464 ms, CLS 0, 25 requests, 323 KB; shop TTFB 181 ms, LCP 336 ms; origin TTFB 53 / 61 ms; edge curl 403 (Cloudflare challenge, recorded as such) |
| Mozilla Observatory v2 | IMPLEMENTED_AND_VERIFIED | B+, 80, 11/12 pass; CSP fails (`unsafe-inline`/`data:` or broad sources) |
| Yellow Lab Tools | IMPLEMENTED_AND_VERIFIED | score 90, DOM 2118, 26 requests, 42 KB JS, 26 duplicate selectors |
| webhint 7.1.13 | IMPLEMENTED_AND_VERIFIED | 115 findings / 51 errors (http-cache ×14, http-compression ×13, css reflows ×63, HSTS ×6, X-Frame-Options, SRI ×1) |
| k6 canary (2 VUs, 30 s, read-only, origin over compose network) | IMPLEMENTED_AND_VERIFIED | p50 149 ms, p95 297 ms, p99 301 ms, error rate 0, 36 requests |
| WebPageTest (desktop + Moto G4) | IMPLEMENTED_AWAITING_CREDENTIALS | `WPT_API_KEY` (paid API plan) |
| WebPageTest e-commerce flow | IMPLEMENTED_AWAITING_CREDENTIALS | `WPT_API_KEY` + `AUDIT_PRODUCT_URL`; stops before payment by construction |
| GTmetrix API 2.0 | IMPLEMENTED_AWAITING_CREDENTIALS | `GTMETRIX_API_KEY` |
| DebugBear Quick Tests | IMPLEMENTED_AWAITING_CREDENTIALS | `DEBUGBEAR_API_KEY` + `DEBUGBEAR_PROJECT_ID` |
| SpeedVitals multi-region TTFB | IMPLEMENTED_AWAITING_CREDENTIALS | `SPEEDVITALS_API_KEY` |
| SpeedCurve | IMPLEMENTED_AWAITING_SUBSCRIPTION (reports AWAITING_CREDENTIALS at runtime until a key exists) | paid product; LUX needed for bounce correlation |
| Loader.io | IMPLEMENTED_AWAITING_CREDENTIALS (+ SKIPPED_FOR_SAFETY today) | `LOADERIO_API_KEY` + verification token; heavy-only |
| Artillery journey | SKIPPED_FOR_SAFETY | no `LOAD_TARGET_URL` |
| k6 checkout stress (heavy) | SKIPPED_FOR_SAFETY | no `LOAD_TARGET_URL`; also refused from the production host |
| Pingdom | BLOCKED_BY_PROVIDER | free tool has no API; official API 3.1 is paid, read-only checks; not scraped |
| KeyCDN Performance Test | UNSUPPORTED_BY_CURRENT_PROVIDER | no official API; not scraped |

Nothing is reported as SUCCESS that did not run.

## 3. Baseline

Run `20260913T065047Z`, kind recurring, label `pre-cloudflare-baseline`, outcome SUCCESS, 75 measurements, repo sha `80c13535`. The regression engine and retention treat every `*baseline` run as protected. When the Cloudflare toggles change, run:

```
cd /opt/goldplus/app/goldplus-commerce/performance-audit
schedule/run-in-container.sh --ad-hoc --label post-cloudflare-$(date -u +%F)
```

and `cloudflare_comparison.md` is produced against the baseline. The ad-hoc run does not move the recurring clock.

## 4. Scheduler state (live)

```
last_attempt_at     2026-09-13T06:50:47Z
last_success_at     2026-09-13T06:52:00Z
last_success_run_id 20260913T065047Z
next_due_at         2026-09-23T06:52:00Z
retry_count 0 · cycle_failed false
```

Daily timer tick → `run_safe_recurring.sh` → due gate (864000 s after the last success) → run → outcome → retries at +6 h / +12 h / +24 h on failure, then a full interval from the last attempt. Reboot: `Persistent=true` catches a missed tick; an overdue audit runs at the first tick after recovery. `flock` prevents overlap (exit 75).

## 5. Load-test safety

Heavy profiles run only against `LOAD_TARGET_URL`. Production requires BOTH `ALLOW_PROD_LOAD_TEST=true` and `PROD_LOAD_TEST_ACK=I_UNDERSTAND_THIS_GENERATES_REAL_TRAFFIC`; a test proves every partial combination is refused. Heavy load is also refused when the runner is the production host. The recurring canary is 2 virtual users for 30 s doing GET / and GET /shop against the origin service over the compose network. No payment, refund, order, inventory, pricing, stock or config path is touched by any runner; journeys stop at checkout entry.

## 6. Credentials and secrets

Only `.env` on the host (mode 600, git-ignored) holds `TARGET_URL` and `PERF_AUDIT_DATA_DIR`. No provider credential exists yet. `config.resolved.json` records credential presence only; redaction covers logs, raw responses and summaries, and a save that would leak a registered credential is refused (tested).

## 7. Artifacts per run

`manifest.json`, `normalized_metrics.json`, `regression.json`, `regression_report.md`, `engineering_report.md`, `executive_summary.md`, `trend_summary.md`, `alerts.json` (recurring), `provider_status.snapshot.json`, `providers/<name>/{status,normalized,raw}.json` + `summary.md`, and `logs/<run>.log`.

## 8. What the smoke runs found and fixed (all FIXED, LIVE VERIFIED)

1. Cloudflare answers every non-browser client from the host with a 403 challenge (curl, k6, Node fetch). The control provider now has three probes: edge curl (connect/TLS/protocol only when challenged), Chromium browser probe (the customer path), origin probe over the compose network. The canary also targets the origin.
2. `.env` sourced with `set -a` inside the container overrode `PERF_AUDIT_DATA_DIR=/data`, so the first run's reports were written into the ephemeral container. `lib/env.sh` now loads `.env` with the process environment winning.
3. k6 treats `K6_VUS` / `K6_DURATION` as its own CLI options (a bare number is milliseconds). Variables renamed to `GP_*`.
4. The k6 image runs as a non-root user and could not write its summary; the work dir is now world-writable for the run.
5. npm replaced the `node_modules` symlink with a real directory, so the cache volume was never used and every run reinstalled. The volume is now mounted directly at `/work/node_modules`.
6. webhint needs `puppeteerOptions.executablePath` to skip its own browser detection; its JSON formatter writes a `<url>: N issues` line before each JSON array and `--output` is a file path.
7. Regression noise: three-sample origin TTFB (60→220 ms) and personalised-hero JS byte variance flagged CRITICAL. CRITICAL now needs both the percentage and an absolute movement above twice the noise floor; a 10 KiB byte floor was added.

## 9. Owner actions (unchanged safety boundary)

1. Cloudflare toggles per `docs/hardening/cloudflare-lighthouse-owner-settings.md`; then the `post-cloudflare-*` ad-hoc run.
2. Provider keys into `performance-audit/.env` on the host: `WPT_API_KEY`, `GTMETRIX_API_KEY`, `DEBUGBEAR_API_KEY` + `DEBUGBEAR_PROJECT_ID`, `SPEEDVITALS_API_KEY`, `LOADERIO_API_KEY` + `LOADERIO_VERIFICATION_TOKEN` (and the static `apps/web/public/loaderio-<token>.txt`), `SPEEDCURVE_API_KEY`, `PINGDOM_API_TOKEN` (paid).
3. A staging `LOAD_TARGET_URL` and an independent load runner before any heavy profile ever runs.
4. `AUDIT_PRODUCT_URL` (a product that stays published) for the WebPageTest flow and Artillery journey.
5. `PERF_AUDIT_ALERT_WEBHOOK_URL` for alert delivery; until then `schedule/status.sh` and `logs/alerts.log` are the surface.
6. Findings measured but out of this mandate's scope (storefront code untouched): CSP `unsafe-inline`/`data:` in script-src (Observatory), missing cache-control/compression on some sub-resources and X-Frame-Options in use (webhint), hidden images / font count (Yellow Lab).

## 10. Self-critique (47 questions)

1. Did every provider get its API verified before implementation? Yes; dates and endpoints are in each runner header and `provider_status.json`.
2. Is any integration reported as SUCCESS without running? No; keyed ones are AWAITING_CREDENTIALS.
3. Could heavy load reach production by accident? No; dual gate + host refusal, unit-tested for every partial combination.
4. Could the canary harm production? 2 VUs / 30 s / GET only against the origin; the edge was not even reachable for it.
5. Does any runner mutate pricing, stock, orders, config, payments? No; the only write is the WebPageTest flow's cart line (a synthetic visitor's cart, no order).
6. Are secrets kept out of logs/YAML/raw responses? Yes; redaction on write plus a refuse-to-save guard, tested.
7. Is the schedule a rolling interval, not a calendar day? Yes; tested (day 9 h23 not due, day 10 due).
8. Do ad-hoc runs reset the clock? No; they never touch state (tested and observed).
9. Are retries bounded? +6 h/+12 h/+24 h then a full interval from the last attempt; tested.
10. What if the host is off on the due day? Persistent timer + overdue = due at the first tick.
11. What if two runs overlap? flock, exit 75.
12. What if the state file is corrupted? Quarantined to `.corrupt-<ts>`, never trusted; tested.
13. Is the write atomic? temp + rename; tested.
14. Where does data live? `/var/lib/goldplus-performance-audit`; git-ignored; 1.2 MB after the baseline.
15. Disk pressure? Host is at 92 %; retention keeps 40 recurring + 20 ad-hoc runs; the node_modules volume is shared and cached.
16. Was the baseline labelled and protected? `pre-cloudflare-baseline`, protected by retention and used by `cloudflare_comparison.md`.
17. Is the baseline the first recurring run? Yes (`--force`), so the ten-day clock starts from it.
18. Is the browser probe a field-device number? No, and the report says so in every answer line.
19. Why is edge TTFB missing? Cloudflare challenges curl; the browser probe carries TTFB. Documented as a limitation, not hidden.
20. Is the origin canary a substitute for edge load behaviour? No; it measures origin latency under light load only. The report labels it `canary-origin`.
21. Did I claim a global percentile or "top 1%"? No; the budget footer forbids it.
22. Is the regression engine noise-aware? Noise floors (100 ms, 10 KiB, CLS 0.02), single-run WARNING, repeat → REGRESSION, CRITICAL needs both percentage and absolute movement.
23. Is attribution evidence-based? Owner hints are heuristics; the engineering report says so and lists the edge-script signal.
24. Are Pingdom/KeyCDN scraped? No; blocked/unsupported and replaced by control measurements clearly labelled as such.
25. Did I modify storefront code? No. The Loader.io verification file is described, not created (no token exists).
26. Did the deploy pipeline change? No; the system is outside the compose stack.
27. Does the container have production secrets? Only `.env` (two non-secret values) and the docker socket for the sibling k6 container.
28. Is the docker socket mount a risk? Yes: root-equivalent on the host. Bounded: read-only code mount, pinned images, no network exposure; documented here.
29. Resource caps? `--cpus 1.5 --memory 1800m`, systemd `Nice=10`, IO idle.
30. Did the six smoke runs touch the real data dir? No; a separate dir, deleted afterwards.
31. Were tests run before commit? Yes; all three suites pass.
32. Can the orchestrator run on the dev Mac? No (bash 3.2, no flock/docker); documented; unit tests and static checks do.
33. Did I re-verify after each fix? Each fix was followed by a full host run.
34. What is still not verified? Every keyed provider's live parsing (no credentials exist); heavy profiles (no target). Statuses say so.
35. Could a provider hang the run? Per-provider `timeout --kill-after`; a missing status file becomes PROVIDER_FAILURE.
36. What if `compare_runs.py` fails? The run continues; the manifest outcome stays FAILED and the scheduler retries.
37. What about the `p99 None` seen mid-way? Fixed by `summaryTrendStats`.
38. Is `repo_sha` recorded? Yes (`80c13535` in the baseline manifest).
39. Alerts without a webhook? Recorded in `alerts.json` + `logs/alerts.log`; documented as OWNER ACTION.
40. Are Cloudflare comparisons automatic? Only when a run is labelled `post-cloudflare*`.
41. Did I invent catalogue or product facts? No.
42. Is the k6 image pinned? `grafana/k6:1.8.1`; Playwright image `v1.61.1-noble`; playwright-core `1.61.1` matches the image's Chromium.
43. Do the Python scripts need packages? No (stdlib only; `requirements.txt` says so).
44. Is `status.sh` correct now? Fixed quoting; utcnow deprecation removed across scripts.
45. Biggest remaining weakness? The measurement corpus is thin until keys exist: real field-like LCP/TBT come from WPT/GTmetrix/DebugBear, all awaiting credentials.
46. Second weakness? webhint flags cache-control/compression on sub-resources that Caddy should already cover; whether that is a Cloudflare-served asset behaviour or a real gap has not been analysed (out of scope for this mandate; recorded as an owner-visible finding).
47. Would I run this on a busier host? The audit is idle-priority and short (~75 s today); with all providers keyed the external waits dominate, not CPU.

## 11. Back-office integration (added 2026-09-13, second pass)

`/admin/seo/performance-audit` (Search Growth group) shows the scheduler
health (HEALTHY / DUE / RETRYING / CYCLE_FAILED / STALE / SCHEDULER_SILENT /
NEVER_RAN / NOT_CONFIGURED, derived only from the audit's state file and the
daily-tick heartbeat), the latest run's key cells, movements beyond noise,
provider statuses, the provider matrix, the run history, and a "Queue the run"
form. Reading needs `seo.view`; queueing needs `seo.audit.run` (Owner holds
both).

How the button works without giving the API any power over the host:

1. The API (`RequestPerformanceAuditRunUseCase`) validates the label, refuses
   the reserved baseline label, refuses a second request while one is queued or
   processing, and refuses the seventh request in a rolling 24 h. It then writes
   `requests/queue/<id>.json` into the audit data directory, which is
   bind-mounted into the API container (`PERFORMANCE_AUDIT_DATA_DIR`). The
   queue directory is the only path the API user can write.
2. systemd path unit `goldplus-performance-audit-request.path` fires
   `schedule/process-requests.sh` on the host, which re-validates every rule,
   runs the request through the same container runner as the scheduler
   (`--ad-hoc --label` or `--force --label` for "recurring now"), and records
   the outcome in `requests/done/<id>.json`. Heavy load cannot be requested
   from this path at all.
3. The page reads the request list and the resulting run.

Every recurring tick now writes `state/last_tick_at` and evaluates the stale
conditions (`alerts.py --stale-check`, at most one delivery per 24 h), so a
scheduler that never manages to run alerts instead of staying silent — the gap
found in this pass's self-critique.

### Self-critique of the second pass

1. Does the API ever execute the audit or touch Docker? No; it writes one JSON file into a sticky directory.
2. Could an admin overload the production host? Six back-office runs per day, one at a time, enforced twice (API and host); each run is ~75 s today at idle priority.
3. Could an admin trigger heavy load? No; the request schema has no such field and the host script never passes `--heavy`.
4. Could a crafted run id read outside the data directory? Run ids must match a UTC stamp and the store re-checks the resolved path; tested.
5. What if the mount is missing on the API? The page says NOT CONFIGURED and refuses requests with 503; nothing is invented.
6. What if the host writes a run while the admin reads? Every read tolerates a missing or half-written file.
7. Is the "recurring now" option dangerous? It only moves the ten-day clock, which the operator may want after a Cloudflare change; it is opt-in in the form.
8. Was the previous pass's biggest silent failure fixed? Yes: a dead timer now shows SCHEDULER_SILENT in the admin and stale conditions are evaluated on every tick.
9. Permissions? Reuses `seo.view` / `seo.audit.run`; no new permission code, no role baseline change.
10. What was verified after the roll (82779b9c, DEPLOYED 4/4 healthy)? LIVE VERIFIED: the bind mount is present in the api container (uid 1000 reads reports, writes only the queue); a request written from inside the api container was picked up by the path unit within seconds and produced run `20260913T071913Z` (SUCCESS, 75 measurements, compared against the baseline, ten-day clock untouched); the admin page rendered HEALTHY, the request row, the finished run, 28 key cells, 15 provider statuses and the matrix. The form's own button was not clicked by the assistant (form submission is an owner action in the browser); the write it performs is byte-identical to the verified one.

## 12. Admin-managed settings (added 2026-09-13, third pass)

Owner requirement: the shell path must keep working, and every operating
setting must be editable from the back office once the site is launched.

`/admin/seo/performance-audit/settings` (reached from the Performance Audit
page) edits: the audited site and test product, a staging load host, the
pages measured, the interval in days (1–30), each provider on/off, the canary
(bounded 1–3 users, 10–60 s), every budget, every regression threshold,
retention, the nine provider credentials and the alert webhook. Reads need
`seo.view`; saving needs `seo.audit.run`; saving a credential additionally
needs `seo.integrations.credentials`. Every save is written to the audit log
with the non-secret values and the names of credentials set or cleared.

Mechanism: the API writes `settings/config.overrides.json` (non-secret) and
`settings/secrets.env` (mode 600, owned by the API user) into the audit data
directory. `lib/config.mjs`, `lib/env.sh` and `lib/perf_audit_py.py` layer
them identically: `audit.config.yaml < .env < admin settings < process env`.
A malformed overrides file is ignored with a reason, shown on the settings
page and in the run log. The runner snapshots its secret-free effective
configuration to `state/config.effective.json` on every run and tick, and the
settings page shows those values as the defaults with an "overridden" badge
where the admin has changed something. "Remove all overrides" returns to the
repository defaults, keeping credentials unless asked.

Deliberately not editable from the browser: `ALLOW_PROD_LOAD_TEST` and
`PROD_LOAD_TEST_ACK`. The validator also refuses a `LOAD_TARGET_URL` on the
production host, and the request schema cannot express "heavy", so no
combination of admin actions can generate real traffic against the live site.

### Self-critique of the third pass

1. Can the admin break the audit with a bad value? Every field is validated (https URLs, identifiers, ranges, allowlisted keys) and the runner tolerates a malformed file by ignoring it with a reason.
2. Can the admin turn the canary into a load test? No: 1–3 users, 10–60 s, 1–4 GET paths.
3. Where do credentials live and who can read them? `settings/secrets.env`, mode 600, owned by uid 1000 in a 700 directory; the root runner reads it; the API never returns values, only presence. This equals the posture of the existing `.env` on the host.
4. Does the shell path still work? Yes: the same files are read by `run_all.sh`, `run_safe_recurring.sh` and every runner; a terminal `.env` still applies where the admin has not overridden.
5. Which wins when both exist? Admin over `.env`, process environment over both; tested in node:test, bash and Python.
6. Is a settings change measured immediately? No, it applies at the next run or tick; the page says so and links to "Queue the run".
7. What if the API cannot write the settings directory? 503 with the reason; nothing half-written (temp file + rename).
8. Any new permission code or role change? None; three existing SEO rights are reused.
