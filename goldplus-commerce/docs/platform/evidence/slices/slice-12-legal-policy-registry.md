# Slice 12 — Legal policy registry, returns/warranty/cookies pages

Date: 2026-07-15 · Branch: `phase-2-measurement-control-tower-completion`

- `apps/web/src/lib/legal-policies.ts`: single source of truth for policy versioning
  and review status. Statuses: `interim_guidance` (privacy, terms — matching their
  existing live copy) and `draft_pending_legal_review` (returns, warranty, cookies).
  **Effective dates are null until legal review sets them — never invented.**
- New pages `/returns`, `/warranty`, `/cookies`: plain-English drafts that state their
  review status in a banner, invent no concrete commitments (no day-windows, no
  refund guarantees — regression-tested), route claims/initiation through the existing
  support workflow (no second ticket model), link the verification checker
  (warranty) and Preference Centre (cookies), and preserve statutory-rights language.
- `/privacy` and `/terms` now display registry status/version/effective-date chips.
- Footer links all five policies.
- Protected `admin/legal.astro` registry view with the exact next operator action
  (sweep inventory 54→55).
- Tests: `Slice12LegalPolicyRegistry.test.ts` (6) — registry completeness, no invented
  effective dates, page↔registry binding, support routing, footer coverage, no
  invented commitments in drafts.

No schema/API change. Legal review of the three drafts is the exact external
requirement before versions become 1.0 with real effective dates.
