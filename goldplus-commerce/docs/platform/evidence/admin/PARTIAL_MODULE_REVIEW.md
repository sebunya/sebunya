# Baseline PARTIAL Modules — Individual Review

All 13 modules classified PARTIAL in the immutable baseline manifest, reviewed
one at a time per §15. Modules are loaded from the manifest, not guessed from
source text.

No module was removed, hidden, or downgraded.

## Method

Each module's referenced admin APIs were probed against production. A `401`
proves the endpoint is mounted and auth-gated; a `404` would prove it missing.
21 distinct endpoints were probed: **20 returned 401**, and the single `404`
was `/admin/settings`, which is a web page route rather than an API — it exists
in the baseline manifest and renders normally.

So no PARTIAL module was blocked by a missing API.

## Findings

| # | Module | Baseline defect | Classification | Action | Final state |
|---|---|---|---|---|---|
| 1 | `/admin/governance` | shared SEO fallback copy | STALE_COPY | fixed at the shared helper | OPERATIONAL |
| 2 | `/admin/merchandising` | shared SEO fallback copy | STALE_COPY | fixed at the shared helper | OPERATIONAL |
| 3 | `/admin/notifications` | "Halted / Muted" | FALSE POSITIVE | none — a real notification state label | OPERATIONAL |
| 4 | `/admin/seo` | shared SEO fallback copy | STALE_COPY | fixed at the shared helper | OPERATIONAL |
| 5 | `/admin/seo/aeo` | "simulated" | FALSE POSITIVE | none — the copy asserts observations are *never* simulated | OPERATIONAL |
| 6 | `/admin/seo/category-matrix` | shared SEO fallback copy | STALE_COPY | fixed at the shared helper | OPERATIONAL |
| 7 | `/admin/seo/integrations` | shared SEO fallback copy | STALE_COPY | fixed at the shared helper | OPERATIONAL |
| 8 | `/admin/seo/integrations/[provider]` | shared SEO fallback copy | STALE_COPY | fixed; also the `supports` DTO repair | OPERATIONAL |
| 9 | `/admin/seo/integrations/[provider]/connect` | shared SEO fallback copy | STALE_COPY | fixed at the shared helper | OPERATIONAL |
| 10 | `/admin/seo/integrations/sync` | shared SEO fallback copy | STALE_COPY | fixed; manual-sync gate repaired | OPERATIONAL |
| 11 | `/admin/seo/storage-tests` | shared SEO fallback copy | STALE_COPY | fixed at the shared helper | OPERATIONAL |
| 12 | `/admin/seo/work-queue` | shared SEO fallback copy | STALE_COPY | fixed at the shared helper | OPERATIONAL |
| 13 | `/admin/users` | "Directory Synchronization Halted" on the error path | STALE_COPY | rewritten to "Could not load the user list" | OPERATIONAL |

## Notes on the two false positives

My baseline classifier matched the literal words `halted` and `simulated`
without reading their context, and both matches were wrong in opposite
directions:

- `/admin/notifications` renders a **"Halted / Muted"** column — a genuine
  notification lifecycle state an operator sets, not a description of
  unfinished software.
- `/admin/seo/aeo` states observations are *"recorded from real sessions —
  never simulated"*, which is the assurance the audit wants, flagged as though
  it were the opposite.

Both are recorded here rather than silently dropped, because a classifier that
over-reports is only safe if its output is actually read.

## The `/admin/users` fix

`Directory Synchronization Halted` rendered whenever the user list failed to
load. There is no directory synchronisation in this module; the real condition
is a failed read, and the old wording implied a suspended feature an operator
would go looking for. It now names the actual condition and keeps the
underlying error message.

## Result

```
PARTIAL_MODULES_REVIEWED=13
STALE_COPY=11   FALSE_POSITIVE=2   BROKEN_API=0   MISSING_DATA_PATH=0
INTERNALLY_CONTROLLABLE_PARTIALS_REMAINING=0
MODULES_REMOVED=0
```
