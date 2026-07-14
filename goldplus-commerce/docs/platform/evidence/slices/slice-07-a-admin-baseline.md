# Slice 7-A admin baseline

Date: 2026-07-14 EAT

## Existing protected surface

- Central route: `/admin`, guarded by the existing `goldplus_session` token check and redirect to `/admin/login`.
- Commerce routes found: products, carts, orders, payments, pricing, inventory, categories and quotes.
- Recommendation routes found: overview, analytics, rules and read-only preview.
- Measurement routes found: Control Tower, controlled activation, live review, handover, consent, attribution and DLQ.
- Operations routes found: support, notifications, audit, governance, users, roles, settings, system and release readiness.

## Gaps found

- The central dashboard claimed cart persistence was operational and recommendation rules were active without deriving either fact from verified data.
- Module cards used only internal `working`, `read_only` and `diagnostic` states, with no next step or disabled-action reason.
- The API base string was rendered on the dashboard even though operators only need connection state.
- No central readiness checklist connected the already released storefront, discovery, support, legal and recommendation safeguards.
- No shared operator empty-state component explained what, why, next step and access posture.
- The Measurement Control Tower page did not apply the same explicit session redirect used by the other central admin routes, and its error/loading copy lacked safe next-step guidance.

## Chosen scope

- Pure web-only admin trust status/config helper.
- Reusable module card, empty-state and readiness checklist components.
- Central `/admin` trust-centre update.
- Measurement Control Tower route-protection consistency and state-copy update only.
- Focused Slice 7-A contract tests and release evidence.

Excluded: auth implementation, RBAC schema/model, owner bootstrap, API code, provider credentials or activation, queues, checkout/payment mutation, support sending, loyalty issuance, environment, backups and secrets.
