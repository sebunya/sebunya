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
