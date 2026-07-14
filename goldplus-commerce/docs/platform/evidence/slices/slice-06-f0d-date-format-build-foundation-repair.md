# Slice 6-F0D date-format build-foundation repair

## Exact repair

- Modified only `apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/[id].astro`.
- Removed the undeclared `date-fns` import.
- Replaced its two display calls with a native `Intl.DateTimeFormat` helper using `en-UG`, `Africa/Kampala`, medium date and short time formatting.
- Invalid or missing values render `Not recorded` rather than throwing or leaking invalid output.

No dependency or lockfile was added. The repair changes no persisted date, status, approval, Measurement event, destination, provider, queue/outbox/DLQ, consent, credential, analytics, network transport, API contract or admin workflow behavior.

## Verification result

`pnpm build` resolved the repaired detail page and then stopped on another undeclared `date-fns` import in the live-review list component. Per the explicit additional-blocker rule, full 6-F0 gates, staging, commit, Slice 6-F1, rehearsal, deployment and push did not proceed.
