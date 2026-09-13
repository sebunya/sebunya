# GoldPlus Continuous Compatibility Assurance

Proves, every rolling ten days and on request, that GoldPlus can be shopped on
the browsers, devices, networks and PWA modes that matter to its customers —
without adding weight to the storefront. Test-only: nothing in this directory
is ever delivered to a customer (the static check refuses any storefront
reference to it).

Two gates apply to every production change made because of a finding:
**Gate A** the reproduced defect is fixed; **Gate B** the performance golden
master is preserved (`performance_non_regression.json`, produced from the
performance-audit's local Lighthouse provider, medians of 3 runs, noise band
= the golden master's own spread).

## How it runs

It is **one provider of the performance-audit system**
(`performance-audit/run_compatibility.sh`), so it shares the rolling ten-day
scheduler, the admin "Queue the run" button, ad-hoc labels
(`post-cloudflare`, `post-checkout-fix`, `post-browser-fix`, `post-pwa-change`,
`pre-launch`, `post-launch`), retention and reporting. The container runner
mounts this directory and installs `@playwright/test 1.61.1` + axe into its
own volume; the image's Chromium, Firefox and WebKit match that version.

```
run_full.sh      every class, constrained profiles, data usage, PWA, a11y, visual, real devices
run_smoke.sh     post-deploy: journeys on low-end + mainstream Chromium, Firefox, WebKit; PWA; one slow profile
run_low_end.sh   the small low-end Android class only
run_pwa.sh       manifest, service worker, offline, capabilities on three engines
COMPAT_MODE=smoke performance-audit/schedule/run-in-container.sh --ad-hoc --label post-deploy   # from the host
```

Locally: `npm install && npx playwright install chromium` then
`COMPAT_TARGET_URL=https://shopgoldplus.com ./run_smoke.sh`.

## Layout

```
playwright.config.ts   projects = engine × device class from device-matrix.json
device-matrix.json     classes, viewports, CPU/network profiles, real-device mapping, tiers
network-matrix.json    plausible network classes (not measured carrier profiles)
journeys/              A discovery, B search, C category, D product, E cart, F checkout entry (never submitted),
                       G battery finder, H product finder, K delivery/support, L WhatsApp (never opened), X back/forward
browser/               early interaction (handler binding vs load; Rocket Loader detection)
responsive/            widths incl. breakpoint −1/0/+1 (380, 640, 768, 980, 1024, 1280), heights, orientation
mobile/                touch targets, hover-free, iOS auto-zoom guard, text scaling (emulated), reduced motion
network/               slow_mobile / high_latency / severe_constrained + CPU, search under constraint,
                       offline→online, storage loss (Chromium CDP: EMULATED_CONSTRAINED_DEVICE)
data-usage/            cold/warm bytes by class per journey
pwa/                   manifest, service worker as delivered, offline, eviction, capability rows
accessibility/         axe (WCAG 2.x A/AA) on meaningful states; keyboard-only pass
visual/                baselines under the audit data dir (never Git), 2 % diff, dynamic regions masked
real-device/           BrowserStack adapter (single provider); AWAITING_REAL_DEVICE without credentials
helpers/               fixtures, console/network monitor, data accounting, profiles, evidence vocabulary
generate_report.mjs    all artifacts below from records/*.jsonl + Playwright JSON
compare_runs.mjs       performance_non_regression.json + bundle_diff.json vs the golden master
```

## Artifacts per run (in `providers/compatibility/compatibility/` of the audit run)

compatibility_manifest.json · compatibility_matrix.json ·
constrained_experience_matrix.json · pwa_capability_matrix.json ·
route_coverage.json · journey_results.json · data_usage_report.json ·
bundle_diff.json · performance_non_regression.json · browser_failures.json ·
pwa_failures.json · service_worker_report.json · manifest_report.json ·
offline_report.json · console_errors.json · network_failures.json ·
visual_regressions.json · accessibility_findings.json · real_device_results.json
· touch_targets.json · responsive_report.json · defects.json ·
compatibility_engineering_report.md · compatibility_executive_summary.md.

## Evidence classes (never collapsed)

ENGINE_CONTROL (Playwright engine on Linux) · EMULATED_VIEWPORT ·
EMULATED_CONSTRAINED_DEVICE · EMULATED_NETWORK · REAL_DEVICE · REAL_BROWSER ·
AWAITING_REAL_DEVICE · AWAITING_REAL_WEBVIEW_VALIDATION ·
MANUAL_AT_VALIDATION_REQUIRED · NOT_TESTED. Playwright WebKit is not Safari;
Playwright Chromium is not Samsung Internet; CPU throttling is not a cheap phone.

## Safety

Never submits checkout, never initiates a payment, never opens a WhatsApp
link, never sends a message. The only production side effect is a cart line
for the test's own fresh browser context. Real-money flows are out of scope;
the PesaPal handoff is reviewed architecturally, not exercised.

## Fix hierarchy (when a finding is real)

1 semantic HTML · 2 CSS · 3 existing configuration · 4 build target ·
5 progressive enhancement · 6 small feature-detected fallback · 7 tiny targeted
polyfill (stop, quantify) · 8 larger dependency (exceptional, owner-approved).
After each fix: reproduce → smallest change → targeted test → Chromium →
Firefox → WebKit → low-end profile → typecheck/tests/build → bundle diff →
performance non-regression → diff review.

## Policies

browser-policy.md · pwa-policy.md · constrained-device-policy.md ·
network-policy.md.

## Owner actions

- One real-device provider credential (`BROWSERSTACK_USERNAME`,
  `BROWSERSTACK_ACCESS_KEY`; enter via Performance Audit → Settings or
  `performance-audit/.env`) to turn AWAITING_REAL_DEVICE into results for iOS
  Safari, Samsung Internet, a real low-end Android and desktop Safari.
- A stable `AUDIT_PRODUCT_URL`.
- Manual VoiceOver / TalkBack / NVDA passes (checklists in
  constrained-device-policy.md).
- Cloudflare Rocket Loader OFF (see the early-interaction finding).
