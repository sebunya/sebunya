# NEXT AUTONOMOUS RESUME — GoldPlus All-Modules Real-SSH Production

## Why this run paused

The controlling contract requires real production deployment and UAT through
`ssh goldplus-prod` against `https://shopgoldplus.com`, and forbids treating localhost
as production. **This execution container has no `ssh` binary** (`command -v ssh` →
absent; there is no key, config, or network path to the production host). Per the
contract's Section 20, all independent source work, tests, migration rehearsal and
release preparation were completed and the run returns:

```
EXECUTION_PAUSED_BY_ENVIRONMENT_LIMIT — REAL SERVER DEPLOYMENT REQUIRED
```

No module is marked `LIVE_VERIFIED` — local proof is rehearsal only.

## What is ready to deploy (branch `phase-2-measurement-control-tower-completion`)

- Head: latest commit on the branch (contains `23637ae` ancestry).
- Runtime RC frozen at `d3836e8`; fulfilment vertical + this SLA/assignment layer are
  reviewed descendants.
- Pending production migrations: **0023 → 0030** (0029 fulfilment_tasks, 0030
  fulfilment priority/SLA/assignment — upgrade-safe backfill).
- Local proofs (rehearsal, NOT production): fresh replay `0000→0030` ✓; upgrade-safe
  0030 on a populated `fulfilment_tasks` table ✓; full HTTP UAT of the order→admin
  fulfilment pipeline incl. assign/priority/overdue/RBAC/audit ✓; gates green;
  architecture 10/10; 25 fulfilment unit tests.

## Exact resume steps (in an environment WITH `ssh goldplus-prod`)

1. `git fetch origin phase-2-measurement-control-tower-completion` → checkout newest clean head.
2. Verify operator approval markers exist on production (never create them):
   - DB/migrations marker — confirm it authorises the **0023→0030** range (see runbook note).
   - `/root/APPROVE_GOLDPLUS_API_WEB_DEPLOY_RC1`.
3. Follow `GOLDPLUS_PRODUCTION_DEPLOYMENT_RUNBOOK.md`: baseline capture → `pg_dump`
   backup + restore proof → build API/web images from the release commit → image-start +
   web smokes → apply 0023→0030 → verify ledger/schema/FK/orphans → recreate api+web only
   (`up -d --no-deps api web`, no Caddy/PostgreSQL/Redis restart).
4. Production UAT against `https://shopgoldplus.com` per `GOLDPLUS_POST_DEPLOYMENT_ACCEPTANCE.md`,
   plus the fulfilment flow: place a UAT order → confirm one admin task, badge, product
   summary, masked contact; transition lifecycle; assign; set priority; observe SLA/overdue;
   confirm 401 unauthenticated and audit rows. Convert verified modules to `LIVE_VERIFIED`.
5. Then continue the remaining module queue (all already SOURCE_COMPLETE_NOT_DEPLOYED):
   search/demand, compatibility, recommendations, support, loyalty, lifecycle/NBA,
   measurement control tower, Decision Intelligence, Automation, Surveys, Copy Quality,
   Behavioural Interventions, Experiments, Pricing/Promotions, Fraud Triage, PIM Import,
   Search Insights. Deploy + production-UAT each; repair engineering-controlled failures.

## Remaining engineering-controlled fulfilment layers (source work, buildable anywhere)

Not yet implemented (safe to build without production access; each touches the checkout
path so verify carefully):
- inventory reservation on OrderPlaced / release on OrderCancelled / stock deduction at
  an approved transition / oversell prevention / partial fulfilment / backorders;
- transactional admin email through the existing outbox (securely-configured recipients,
  retry, DLQ, manual replay, delivery audit) — provider-gated, no-send until approved;
- team queues, escalation notifications, dispatch tracking / delivery confirmation fields.

## True external blockers (unchanged)

`ssh goldplus-prod` access · docker daemon for image build/smoke · operator approval
markers · provider/customer send activation · commercial loyalty activation · legal review.
