# Slice 6-F0D date-fns build blocker

`pnpm build` failed while resolving `date-fns` from:

```text
apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/[id].astro
```

The page imported `format` and used it twice to render `candidate.createdAt` and `approval.approvedAt`. Neither the root package nor the web package declares `date-fns`.

These values are display-only: they do not affect persistence, status, approval logic, events, providers, queues, consent or API contracts. The chosen repair is an inline native `Intl.DateTimeFormat` helper because only two calls in the authorized detail page require replacement. No dependency or lockfile change is needed.

## Additional baseline blocker

After the detail-page repair, the build advanced and failed on a separate `date-fns` import in `apps/web/src/components/admin/controlled-activation-live-review/LiveReviewCandidateList.astro`. That list component contains one display-format call and is part of the same live-review family, but it was not included in the detail-page-only authorization.

The component was not modified. Decision: `SLICE_6_F0D_BLOCKED_BY_ADDITIONAL_BASELINE_BLOCKERS`.
