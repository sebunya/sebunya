# Commerce Analytics V2 — Security Review

Scope: everything added on `claude/advanced-analytics-command-centre-v2-20260802`
(shared analytics package, `/admin/analytics` API, analytics page, navigation).

## Authentication and authorisation

- Every `/admin/analytics/*` endpoint sits behind `authMiddleware` plus
  `requirePermissions([PERMISSIONS.ANALYTICS_READ])` — deny-by-default via the
  existing fail-closed middleware (denials are logged with actor and missing
  permission, never the token).
- `analytics.read` is a dedicated permission: an operator with only, say,
  `surveys.read` receives 403 on every analytics endpoint (tested for all five
  endpoints in `tests/unit/CommerceAnalyticsApi.test.ts`).
- The web page renders a dedicated permission-denied state on 403 and shows no
  data. Unauthenticated visits redirect to the admin login.

## Data exposure

- The analytics API returns **aggregates only**. No endpoint returns customer
  name, phone, email, address, order line detail or any identifier other than
  Kampala-day buckets and totals. The previous design's page-side download of
  the complete `/governance/admin/orders` ledger is gone; the page holds no
  order records at all.
- `search_demand_signals` is an aggregate-only table by design (no
  actor/session/cart/order key), so search metrics cannot leak personal data.
- Source-freshness output contains timestamps and status only.

## Input handling

- All period input is zod-validated (`YYYY-MM-DD`, days 1–366) before any
  use-case executes; reversed and over-long periods map to 400s, unknown
  metrics to 404. SQL access goes through drizzle's parameterised `sql`
  template — no string-built SQL.

## Query safety

- Every query is a bounded aggregate over indexed columns
  (`orders.created_at` btree via existing indexes; whole-table sums on the
  small rolled-up `search_demand_signals`), inside the client's global 5s
  statement timeout. The period ceiling (366 days) bounds the widest scan.

## Configuration, exports and alerts (slices 5-6)

- Four permissions, deliberately separated: `analytics.read` (view data and
  configuration), `analytics.manage` (create/change/delete saved views),
  `analytics.alerts.manage` (alert rules), `analytics.export` (exports).
  Holding read grants none of the others; tests assert each boundary.
- Ownership is enforced in the SQL predicate, not by a caller remembering to
  filter: another operator's PRIVATE saved view never leaves the database, and
  update/delete are owner-scoped. A refusal reports NOT_FOUND so row ids
  cannot be probed.
- Every configuration mutation and every export writes an audit event with
  actor, entity and new state. A refused mutation writes none.
- Alert rules cannot deliver anything. The table has no destination, channel,
  recipient, webhook or provider column — asserted by an integration test
  against the real schema — and evaluation returns internal action objects
  only. Turning alerts into an outbound path would require a new migration.
- Alert rules cannot be configured below the catalogue's minimum-sample floor;
  a request for a lower floor is silently raised to the catalogue value rather
  than accepted.
- Exports are bounded (5 000 rows), carry only daily aggregates plus metric
  definitions, and are never sent anywhere — the response is returned to the
  caller. Tests assert no customer field or token can appear.
- Drilldowns project order number, state, age and amount only. The breakdown
  dimension is an allowlist (`payment_status`, `fulfilment_status`); an
  unknown dimension is a 404 and never reaches SQL.

## Residual risks / not in scope
- Analytics reads are not rate-limited beyond platform-wide controls; they are
  read-only aggregates behind authentication.
- `analytics.read` must be granted to roles by an administrator before
  operators see the page; the acceptance bootstrap grants all permissions in
  dev environments.
