# Commerce Analytics V2 — UAT Specification

Preconditions: an admin user whose role includes `analytics.read`; a second
user without it. No production data is required — any environment with the API
and web apps running.

## 1. Access control

| Step | Expect |
|---|---|
| Visit /admin/analytics signed out | redirect to /admin/login?returnTo=/admin/analytics |
| Visit with a user lacking analytics.read | "You do not have analytics access" panel naming `analytics.read`; no metrics rendered |
| GET /admin/analytics/overview without token | 401 |
| GET /admin/analytics/overview with token lacking permission | 403 |

## 2. Period handling (Africa/Kampala)

| Step | Expect |
|---|---|
| Open /admin/analytics | default 30-day period whose end day is today in Kampala, not UTC |
| Set start 2026-08-03, end 2026-08-02 | error banner "end date cannot be earlier"; page falls back to default period |
| Set a >366-day range | "exceeds the 366-day maximum" banner |
| Place a test order at 21:30 UTC | it appears on the NEXT Kampala day in the trend table |

## 3. Metric truthfulness

| Step | Expect |
|---|---|
| Period with no orders | Orders shows 0 as a MEASURED value; Average paid order value shows "No data in period", not 0 |
| Fewer than 5 orders in period | rate cards show "Insufficient evidence" with n = count |
| Stop the API service, reload | single red "Commerce Analytics API is unavailable" panel; no sample numbers anywhere |
| Rising payment failure rate vs comparison | change renders RED even though the number went up |
| Discount value change | renders neutral slate, never green/red |

## 4. Actions

| Step | Expect |
|---|---|
| ≥10 tracked searches with ≥25% zero-result | HIGH "Search demand is not being served" with exact counts, deep link to /admin/demand |
| 4 searches, all zero-result | NO search action (minimum volume suppressed) |
| Any low-stock products | replenishment action with count and /admin/inventory link |

## 5. Panels and navigation

| Step | Expect |
|---|---|
| Recommendation engagement panel | separate from Commerce outcomes; linkage statement visible; no funnel between them |
| Trend chart | data table alternative under "Data table for this chart" |
| Sidebar | "Commerce Analytics" → /admin/analytics; "Recommendation Analytics" → /admin/recommendations/analytics |
| Control Centre | commerce-analytics card present, LOW risk, opens /admin/analytics |

## 6. Saved views, alert rules and exports

| Step | Expect |
|---|---|
| As a user with analytics.read only, POST /admin/analytics/saved-views | 403; nothing created |
| With analytics.manage, create a view naming a metric that does not exist | 400 naming the unknown key |
| Create two views with the same name as the same operator | second is 409 DUPLICATE_NAME |
| Create a view with no periodDays and no start/end day | 400 |
| Share a view (scope SHARED) | another operator sees it in GET /saved-views |
| Keep a view PRIVATE | another operator does NOT see it, and PATCHing its id returns 404 |
| Create an alert rule with minimumSample 1 on payment_failure_rate | stored with minimumSample 5 (catalogue floor), not 1 |
| Create an alert rule with threshold 4 on a rate metric | 400 |
| GET /admin/analytics/alert-rules/evaluations | each rule reports FIRED / WITHIN_THRESHOLD / INSUFFICIENT_SAMPLE / NO_VALUE / IN_COOLDOWN; no message is sent anywhere |
| Fire a rule, then evaluate again inside the cooldown | second evaluation reports IN_COOLDOWN, no duplicate action |
| POST /admin/analytics/exports with analytics.manage but not analytics.export | 403 |
| POST /admin/analytics/exports with analytics.export | CSV of daily aggregates plus definitions; an audit entry exists |

## 7. Payment intelligence and drilldowns

| Step | Expect |
|---|---|
| GET /admin/analytics/payments | attempt counts, and an attempt success rate labelled with the attempt denominator |
| Period with fewer than 5 attempts | rate shows Insufficient evidence, not 0% or 100% |
| A provider status the reconciliation vocabulary does not know | counted under "Unrecognised status" and called out in notes; not counted as success or failure |
| GET /admin/analytics/breakdowns/customer_email | 404 UNKNOWN_DIMENSION |
| GET /admin/analytics/exceptions/paid_not_processing?limit=0 | 400 |
| GET /admin/analytics/exceptions/paid_not_processing | order numbers, states, age and amount only — no customer name, phone, email or address |
