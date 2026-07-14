# Slice 9-B Consent Preference Centre baseline

- Captured: 2026-07-14 (Africa/Kampala)
- Source baseline: `2e8c8a5b0a6392dceaca4cf761d1310e2a845fe9`
- Branch: `phase-2-measurement-control-tower-completion`
- Remote baseline: `origin/phase-2-measurement-control-tower-completion` at the same commit; ahead 0, behind 0.
- Starting index/worktree: clean in the isolated next-phase worktree.
- Dirty original worktree: not used, read, cleaned, stashed or modified.
- Production host Git metadata: `f69aa6e038fb1bd0964a1cf0cdb6e6ee0208a751`; known older metadata is not source truth and is not being broadly repaired in this slice.
- Pre-deploy runtime: homepage 200, shop 200, checkout 303, `/admin/login` 200, `/admin/measurement` 303, two web replicas healthy.
- Pre-deploy `/preferences`: 404, confirming the public P0 route is not yet live.
- Pre-deploy host shape: `preferences.astro`, `consent.astro` and `preference-centre.ts` absent; existing `BaseLayout.astro` SHA-256 `35a7409428aa1a0ed6f4f5783be2adbd858742ea28a40a45cfc96b2312c7b7e1`.

## Scope boundary

Web-only static customer guidance. No persistence, account mutation, customer state, provider send, transport, queue, outbox, loyalty ledger, reward, discount, coupon, personalised price, checkout/payment/order mutation, auth/RBAC rewrite, Measurement change, migration, environment file or secret change is authorized.

## Baseline rollback posture

Before overlay, the changed host paths will be copied into a timestamped backup directory with relative paths preserved. New files will be removed during rollback; the prior `BaseLayout.astro` will be restored; web will be rebuilt and only web replicas recreated. No Git pull or host reset is part of rollback.
