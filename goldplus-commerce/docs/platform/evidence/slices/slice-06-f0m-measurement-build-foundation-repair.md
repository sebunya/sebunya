# Slice 6-F0M Measurement build-foundation repair

## Exact runtime repair

- Added `apps/web/src/utils/api-fetch.ts`.

The utility exists solely to satisfy the two already-tracked read-only admin imports. It uses the existing public API base, preserves native `Response` semantics, and delegates to native `fetch` only when called.

It does not implement or activate Measurement features. It adds no event dispatch, destination routing, provider activation, queue/outbox/DLQ behavior, consent logic, credential handling, analytics changes, API contract, environment value, customer data handling or import-time side effect.

No existing Measurement page, API route, provider, queue or transport implementation was modified.

## Verification result

The original missing `utils/api-fetch` import is repaired: `pnpm build` moved beyond that resolution step. The next build step failed on a separate baseline import of uninstalled `date-fns` from the sibling live-review detail page.

Per the explicit stop rule for another unrelated baseline missing import, the broader 6-F0 gates, commit, Slice 6-F1, rehearsal, deployment and push did not proceed. Decision: `SLICE_6_F0M_BLOCKED_BY_BUILD_REPAIR`.
