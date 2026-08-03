# UI / product debt register
SHA `473ede0` · 2026-08-03. From UI_API_CONTRACT_INDEX + live sweeps. Debt ≠ defect: everything here works truthfully today; these are the gaps between "renders correctly" and the V4 product bar.

| # | Surface | Debt | Severity | Planned action |
|---|---|---|---|---|
| 1 | `/admin/platform-modules` | Consolidated read surface, not the §9 capability hub (no health/activation/risks/actions per capability) | M | BUILD_GAP_ONLY at phase 9 |
| 2 | `admin/measurement-control-tower.astro` | Hand-builds API base from `PUBLIC_API_URL` instead of canonical `apiBase` | M | HARDEN: migrate to lib/api (small) |
| 3 | 5 measurement pages call same-origin BFF proxy without canonical clients | By design (proxy attaches bearer server-side) — NOT debt; recorded to stop re-flagging | — | KEEP; pattern documented in CANONICAL_OWNERSHIP |
| 4 | Cart page dual-path (server cart primary, local-cookie fallback) | Fallback can mask server-write failures behind a 303 (RC-7 was invisible) | M | HARDEN later: surface a truthful "saved on this device only" notice when fallback engages |
| 5 | Orders/fulfilment/fraud/inventory admin | Read-heavy; §12-§16 operator actions (assign/hold/refund/adjust with reason+audit) largely missing | H | BUILD_GAP_ONLY when those phases run |
| 6 | Legal pages | Static text, no §7 CMS workflow | H | BUILD_GAP_ONLY phase 8 |
| 7 | Product/media management | No DAM (§8); images are catalogue URLs; no picker/variants/rights | H | BUILD_GAP_ONLY phase 2 |
| 8 | Campaigns | Schema only (orphaned tables); NO UI must pretend otherwise | H | BUILD_GAP_ONLY phase 6 (no-send first) |
| 9 | apps/web + packages/shared | No in-package test suites (root suites cover indirectly) | M | add targeted suites opportunistically with each touched surface |
| 10 | 14 permission constants guard no route | Vocabulary ahead of wiring (e.g. payments.confirm, categories.manage) | L | wire when owning modules are scheduled |
