# GoldPlus All-Modules Production Matrix

Updated: 2026-07-18 · Branch `phase-2-measurement-control-tower-completion`

> **Production gate:** `ssh goldplus-prod` is unavailable in this container (no `ssh`
> binary). Nothing below is `LIVE_VERIFIED` — every "local proof" is production-shaped
> rehearsal only. `LIVE_VERIFIED` requires real-server evidence against
> `https://shopgoldplus.com` (contract §9, §10, §20).

## Legend
`SCND` = SOURCE_COMPLETE_NOT_DEPLOYED · `EXT` = EXTERNAL_BLOCKED (production SSH / operator markers)

## Module status

| Module | Layers present | Local proof | Production | Status |
|---|---|---|---|---|
| Order→admin fulfilment (Sec 9.3) | domain, use cases, port, repo, 0029, routes, UI, RBAC, audit, idempotency | order→task, idempotent replay, lifecycle, 401, audit | not deployed | SCND / EXT |
| Fulfilment assignment+priority+SLA+overdue (Sec 12) | domain, use cases, port, repo, 0030, routes, UI, RBAC, audit | assign/priority/overdue badge/assignee filter/401/400/audit + upgrade-safe 0030 | not deployed | SCND / EXT |
| Measurement Control Tower | 10-E client.unsafe fix, summary contract | 401/200 summary at RC | not deployed | SCND / EXT |
| Checkout / orders / payments (Slice 3) | server-authoritative pricing, zones, reconciliation, 0023 | forged-price ignored, idempotent, zone fee | not deployed | SCND / EXT |
| Search / demand (Slice 4) | suggest, demand capture, admin queue, 0024 | live locally | not deployed | SCND / EXT |
| Compatibility (Slice 5) | declared verdicts, 0025, PDP, admin CRUD | tests | not deployed | SCND / EXT |
| Recommendations (Slice 6) | V2 engine, admin control room | tests | not deployed | SCND / EXT |
| Admin control centre (Slice 7) | truthful states, protection sweep (57 pages) | tests | not deployed | SCND / EXT |
| Loyalty (Slice 8) | ledger, 0026, admin/customer UI | tests (dormant) | not deployed | SCND / EXT + activation |
| Customer DNA / lifecycle / NBA (Slice 9) | deterministic stages, suppression-first NBA | tests | not deployed | SCND / EXT |
| Support inbox (Slice 11) | transitions, SLA, assignment, 0027, audited PATCH | tests | not deployed | SCND / EXT |
| Legal / returns / warranty (Slice 12) | policy registry, pages | tests | not deployed | SCND / EXT + legal review |
| A11y / perf / cross-browser (Slice 13) | static contract, Playwright 12/12 Chromium | local | Firefox/WebKit/Lighthouse | SCND / EXT |
| Decision Intelligence, Automation, Surveys, Copy Quality, Behavioural Interventions, Experiments, Pricing/Promotions, Fraud Triage, PIM Import, Search Insights | prior-slice source modules | prior tests | not deployed | SCND / EXT |

## This session's delta (verified locally, production-shaped)

- Migration `0030_sharp_omega_sentinel.sql`: adds `priority`, `sla_due_at`, `assigned_at`
  to `fulfilment_tasks`; upgrade-safe (nullable → backfill `created_at + 24h` → SET NOT NULL).
  Proven on both a fresh `0000→0030` replay and a **populated** table.
- Deterministic SLA windows: urgent 4h / high 12h / normal 24h / low 48h; re-prioritising
  recomputes from original creation time (not gameable). Overdue = past deadline & active.
- New endpoints `PATCH /admin/fulfilment/:id/assign` and `/:id/priority` (orders.manage,
  audited); queue gains `assignedTo` filter + per-row `overdue`; badge gains `overdue`.
- Gates: secret/typecheck/lint/build green; architecture 10/10; fulfilment unit tests 25.

## Remaining engineering-controlled fulfilment work (source, buildable without SSH)

inventory reservation/release/deduction, oversell prevention, partial fulfilment,
backorders, transactional admin email (outbox, retry, DLQ, manual replay, delivery audit),
team queues, dispatch tracking, delivery confirmation. See `NEXT_AUTONOMOUS_RESUME.md`.
