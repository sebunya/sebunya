# Slice 6-F0DL live-review date-chain blocker

The authorized-family scan found two baseline `date-fns` imports:

- the live-review detail page, with two display-only timestamp calls;
- `LiveReviewCandidateList.astro`, with one display-only timestamp call.

Neither the root nor web package declares `date-fns`. No other import was found inside the authorized live-review route/component family.

The chosen repair is a pure shared `apps/web/src/utils/date-format.ts` helper based on `Intl.DateTimeFormat`. Both UI files use that helper, avoiding duplicated inline logic, dependency expansion and lockfile changes.

No status, link, action, API request, persistence, Measurement event, destination, provider, queue/outbox/DLQ, consent, credential, analytics or admin workflow behavior is changed.
