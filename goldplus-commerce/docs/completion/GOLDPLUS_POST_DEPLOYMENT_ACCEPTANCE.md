# GoldPlus Post-Deployment Acceptance (war-room checklist)

Run after the operator-approved deploy of the RC. Convert to LIVE_VERIFIED per row.

1. `git rev-parse HEAD` on prod == release commit; image digests == RC manifest.
2. Health: storefront 200, `/health` 200, admin logged-out 303, Caddy/PG/Redis
   container IDs and start times UNCHANGED.
3. **Control tower:** `/admin/measurement-control-tower` renders readiness data
   authenticated (contract keys per preservation matrix); banner appears ONLY on real
   failures; API logs clean.
4. Migration ledger = 29 rows; four `release_%users_id_fk` constraints valid;
   pre-flight non-uuid count was 0; new tables exist.
5. Checkout live battery (safe): forged-price body → catalogue total; duplicate
   clientOrderKey → same order; unknown product → PRODUCT_UNAVAILABLE.
6. Login lockout: 5×401 → 429 + Retry-After (use a test identity).
7. Authenticated admin battery per slice-14e evidence (zones, demand, compat,
   loyalty-dormant, reconciliation, lifecycle, support, recommendations) + audit rows.
8. No-send counters: outbox rows 0 delivered, notification attempts unchanged,
   provider flags false.
9. Zero-result search on prod creates/increments a demand row (then mark reviewed).
10. Rollback immediately on any failed gate using the fresh rollback tags (≤10 min).
