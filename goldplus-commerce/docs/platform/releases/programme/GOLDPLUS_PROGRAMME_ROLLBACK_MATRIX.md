# GoldPlus programme rollback matrix

Rollback uses the fresh pre-release API/web tags. Caddy, PostgreSQL and Redis are never restarted. No destructive migration is permitted.

| Trigger | Detection | Immediate action | Required proof after rollback |
| --- | --- | --- | --- |
| Health/readiness failure | any persistent API/web non-200 or unhealthy state | restore API/web rollback tags and recreate API/web only | health, image IDs, no non-target restart |
| Late runtime exit/restart | any unexplained post-recreation exit or restart | rollback API/web immediately | stable restart counts and clean late-error window |
| DB-client/ESM/UUID failure | compiled postgres-js/Drizzle, module resolution or UUID error | rollback API/web; retain additive schema only because old-runtime compatibility was pre-proven | old API reads upgraded schema safely |
| Migration incompatibility | schema/data invariant or old-runtime health failure before recreation | abort before recreation; keep old runtime; invoke prewritten recovery decision | production health and data reconciliation |
| Price/checkout/payment mismatch | any canonical/displayed/cart/order/PesaPal divergence | rollback API/web immediately; stop UAT | bounded prices and payment/order totals restored |
| Catalogue parity divergence | independent SQL, either direct API replica, public API or storefront count/identifier/price hash differs; any zero-product result | rollback API/web immediately; stop UAT | both replicas and public/storefront evidence match independent SQL |
| Inventory/fulfilment regression | unexpected count/state delta or read failure | rollback API/web immediately | inventory/fulfilment reconciliation |
| RBAC exposure | protected route/API succeeds without required identity/permission | rollback API/web immediately | complete denial matrix restored |
| Provider/customer communication | provider attempt, notification attempt, send or gate enablement | rollback API/web immediately and stop workers through API rollback only | gates false; counters reconciled; no further attempts |
| Queue/outbox storm | unexpected queue growth, retries or processing loop | rollback API/web immediately | queue/outbox depth stable at baseline |
| Unintended module activation | promotion, Experiment, Automation, Survey, PIM, Fraud, intervention, Loyalty or Search dormant invariant changes | rollback API/web immediately | every dormant-state counter restored/explained |

## Rollback command boundary

- Point only the API and web service image references at their verified fresh rollback tags.
- Run Compose `up -d --no-deps api web` only.
- Never run `docker compose down`, restart infrastructure or apply a down migration.
- If the old-runtime compatibility proof no longer holds, stop and use the prewritten database recovery plan; do not improvise a live restore.
- After rollback, reconcile migration rows, schema, public prices, orders/payments, Inventory/fulfilment, outbox/provider/notification activity, all dormant states and Caddy/PostgreSQL/Redis identities.
- Final classification after rollback must use the matching truthful rollback decision and must never claim `LIVE_VERIFIED`.
