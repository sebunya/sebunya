# GoldPlus network policy (2026-09-13)

## Profiles (network-matrix.json)
fast_reference · normal_4g · slow_mobile (3G-like) · high_latency ·
intermittent (online → offline → online) · severe_constrained. These are
plausible classes; they are **not** measured Ugandan carrier profiles and are
never reported as such. Applied through Chromium CDP only (EMULATED_NETWORK);
Firefox and WebKit run unthrottled.

## What must hold
- Every constrained profile completes home → product → add to cart.
- A dropped connection during search suggestions must not read as an empty
  catalogue ("No match"); the form submit remains the contract once online.
- Offline: sensitive routes fail visibly; precached shell routes serve the
  snapshot or the offline page; never blank, never a false success.
- Reconnect: no duplicate cart lines, no lost lines.

## Data budget
Budgets are set from the measured golden master, not invented. Cold and warm
totals per journey are recorded every run (data_usage_report.json) and
compared in bundle_diff.json. Growth above 10 KiB or 2 requests on any journey
without an explanation is a finding. First-visit cost includes the service
worker's eight precache entries; that is by design and bounded.

## Third parties
Analytics and beacons are subordinate to commerce: their failure is recorded
as OPTIONAL_THIRD_PARTY, never as a commerce failure, and must never block a
journey. Cloudflare-injected scripts (Rocket Loader, Web Analytics beacon,
JS detections) are Cloudflare-owned; the audit reports their effect and never
changes the zone configuration.
