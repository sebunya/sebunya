# Experimentation Engine (A/B Testing)

A lightweight, server-side experimentation engine in the spirit of VWO/AB Tasty,
built on the first-party event store.

## Concepts

- **Experiment**: key, name, hypothesis, target metric, status, 2–6 weighted variants.
- **Deterministic assignment**: variant = FNV-1a hash of `experimentKey::visitorId`
  mapped onto the variant weights. The same visitor always sees the same variant —
  no assignment table needed, stable across visits and devices sharing the id.
- **Exposure tracking**: every assignment records an `EXPERIMENT_EXPOSURE`
  activity event (`entityId` = experiment key, `properties.variant` = variant key),
  so reach and KPI impact are measured from the same first-party store.

## Lifecycle

`DRAFT → RUNNING → PAUSED ⇄ RUNNING → COMPLETED` (enforced; completed experiments
cannot be restarted, and only RUNNING experiments serve assignments).

## Admin API (permission `experiments.manage`; writes are audit-logged)

```
GET    /admin/experiments                 # list
POST   /admin/experiments                 # create (starts as DRAFT)
PATCH  /admin/experiments/:key/status     # { "status": "RUNNING" | "PAUSED" | "COMPLETED" }
```

Create payload:

```json
{
  "key": "homepage-hero",
  "name": "Homepage hero headline",
  "hypothesis": "A benefit-led headline lifts add-to-cart rate",
  "targetMetric": "conversion_rate",
  "variants": [
    { "key": "control",   "name": "Current headline", "weight": 1 },
    { "key": "variant_b", "name": "Benefit headline",  "weight": 1 }
  ]
}
```

## Public assignment API

```
GET /events/experiments/:key/assignment
```

Uses the `gp_vid` cookie (or `?visitorId=`) and returns:

```json
{ "experimentKey": "homepage-hero", "variantKey": "variant_b", "variantName": "Benefit headline", "visitorId": "…" }
```

`404` unknown experiment · `409` experiment not RUNNING.

## Measuring results

Exposures and conversions live in `activity_events`. Example (conversion rate by
variant):

```sql
WITH exposed AS (
  SELECT DISTINCT visitor_id, properties->>'variant' AS variant
  FROM activity_events
  WHERE event_type = 'EXPERIMENT_EXPOSURE' AND entity_id = 'homepage-hero'
)
SELECT e.variant,
       COUNT(DISTINCT e.visitor_id)                          AS exposed,
       COUNT(DISTINCT c.visitor_id)                          AS converted,
       ROUND(COUNT(DISTINCT c.visitor_id)::numeric
             / NULLIF(COUNT(DISTINCT e.visitor_id), 0), 4)   AS conversion_rate
FROM exposed e
LEFT JOIN activity_events c
  ON c.visitor_id = e.visitor_id AND c.event_type = 'CHECKOUT_COMPLETED'
GROUP BY e.variant;
```
