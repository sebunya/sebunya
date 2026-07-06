# Admin Dashboard Metrics

A single aggregated endpoint powering the admin overview: sales performance,
customer engagement, and system health over a configurable window.

## API

```
GET /admin/dashboard?days=7      (permission dashboard.read)
```

`days` is clamped to 1–90 (default 7). Response:

```json
{
  "since": "2026-06-29T00:00:00.000Z",
  "days": 7,
  "commerce": {
    "orderCount": 42,
    "paidOrderCount": 30,
    "paidRevenue": 12500000,
    "topProducts": [{ "productName": "Solar Panel 450W", "sku": "SP-450", "quantity": 18 }]
  },
  "engagement": [{ "eventType": "PAGE_VIEW", "count": 1200 }],
  "system": { "pendingOutboxEvents": 0, "failedNotifications": 0 }
}
```

- **commerce** — order count, paid-order count, paid revenue (UGX), and top
  products by quantity, computed with efficient grouped SQL in
  `DrizzleDashboardReadRepository` (single scan per metric, indexed on
  `orders.created_at`).
- **engagement** — first-party activity-event counts by type over the window.
- **system** — outbox backlog (unprocessed events) and failed notification
  attempts, so operators can spot delivery problems at a glance.

The three sources are fetched in parallel (`Promise.all`) in
`GetAdminDashboardUseCase`.

## Extending

Add a metric by extending `IDashboardReadRepository` and the DTO — the read
repository is a dedicated port kept separate from write repositories, so
dashboard queries stay isolated and easy to optimise.

## Testing

`tests/unit/AdminDashboard.test.ts` — aggregation shape and window clamping
(default 7, max 90) against a fake read repository.
