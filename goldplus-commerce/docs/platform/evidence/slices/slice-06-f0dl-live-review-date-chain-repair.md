# Slice 6-F0DL live-review date-chain repair

## Files and scope

- Added `apps/web/src/utils/date-format.ts`.
- Updated the live-review detail page to use the shared formatter.
- Updated `LiveReviewCandidateList.astro` to use the same formatter.
- Added `tests/unit/Slice06F0DLiveReviewDateFormatFoundation.test.ts`.

The formatter is pure display infrastructure using `Intl.DateTimeFormat` with `en-UG`, `Africa/Kampala`, medium date, short time and a safe fallback. The undeclared dependency was avoided and the lockfile was not changed.

No Measurement feature behavior, status logic, actions, links, API calls, data mutation, event dispatch, destinations, provider, queue/outbox/DLQ, consent, credential, analytics or workflow code changed. Recommendation work remains preserved and was not modified before 6-F0 completion.

## Gates

- Formatter foundation: 7/7 tests passed.
- Slice 2 storefront: 3/3 passed.
- Slice 3 checkout/location/payment: 4/4 passed.
- Slice 3-B auth/access trust: 4/4 passed.
- Slice 4 PDP trust: 4/4 passed.
- Slice 5 product discovery: 10/10 passed.
- Slice 6 support/order confidence: 7/7 passed.
- Slice 6-D legal routes: 7/7 passed.
- Secret scan: passed, 858 source/config files checked without printing values.
- Typecheck: passed.
- Lint: passed with existing warnings and zero errors.
- Build: passed; API and web completed.

Result: Slice 6-F0 foundation is ready for scoped allowlist staging and commit. Production remains unchanged.
