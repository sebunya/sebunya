# GoldPlus programme safe production UAT matrix

Every check is read-only, permission-denied, empty-state, non-persistent simulation or dry-run. Do not exercise a mutating administrator control or create a customer/business event.

| Surface | Public/protected route | Safe proof | Forbidden effect |
| --- | --- | --- | --- |
| Storefront | `/`, `/shop`, representative `/products/<slug>` | HTTP health, canonical displayed prices and no automatic discount | catalogue or price write |
| Cart/checkout | `/cart`, `/checkout` | empty/read health; confirm server-authoritative total guard without submitting an order | reservation, order or payment |
| Fulfilment | `/admin/fulfilment`, `/api/admin/fulfilment/*` | logged-out denial and authenticated persisted summary | assignment/status transition |
| Inventory | `/admin/inventory`, `/api/admin/inventory/*` | logged-out denial and read summary | reservation/adjustment |
| Transactional admin email | `/admin/notifications/order-emails`, `/api/admin/notifications/*` | logged-out denial; configuration/status read | retry/send |
| Recommendations | `/admin/recommendations`, `/api/admin/recommendations/*` | logged-out denial; safe preview/read | materialization/publication |
| Measurement | `/admin/measurement-control-tower`, `/api/admin/measurement/*` | logged-out denial; read-only summary | replay/activation |
| Customer DNA and NBA | `/admin/customer-dna`, `/api/admin/customer-dna/*` | logged-out denial; existing read or truthful empty state | recompute/merge |
| Decision Intelligence | `/admin/decision-intelligence`, `/api/admin/decision-intelligence/*` | logged-out denial; persisted read | acknowledge/assign/resolve |
| Automation | `/admin/automation`, `/api/admin/automation/*` | logged-out denial; read summary and explicit dry run with zero calls | activate/execute/replay/reconcile |
| Experiments | `/admin/experiments`, `/api/admin/experiments/*` | logged-out denial; read/empty state | activate/assign/expose |
| Pricing | `/admin/pricing`, `/api/admin/pricing/*` | logged-out denial; canonical non-persistent simulation | activation/reservation/redemption |
| Fraud Triage | `/admin/fraud`, `/api/admin/fraud/*` | logged-out denial; read/empty state | signal/assign/decision |
| PIM Import | `/admin/pim-imports`, `/api/admin/pim-imports/*` | logged-out denial; read/empty state | ingest/apply/rollback/publication |
| Shopping Assistant | `/product-finder`, `/api/product-finder/*` | shell health only; no session completion | session/action/cart/provider event |
| Surveys | `/admin/surveys`, `/api/admin/surveys/*` | logged-out denial; read/empty state | activation/invitation/response |
| Copy Quality | `/admin/copy-quality`, `/api/admin/copy-quality` | logged-out denial; read-only deterministic report | rewrite/export mutation/publication |
| Behavioural Interventions | `/admin/behavioural-interventions`, `/api/admin/behavioural-interventions/*` | logged-out denial; read/empty state | activate/expose/outcome |
| Loyalty | `/admin/loyalty`, `/api/admin/loyalty/*` | logged-out denial; liability/configuration read | earn/redeem/expire/reverse/configure |
| Search Insights | `/admin/demand`, `/api/admin/search-demand/insights` | logged-out denial; thresholded persisted read | synonym/ranking application |
| Consent operations | `/admin/consent-operations`, `/api/admin/consent/operations/summary` | logged-out denial and read-only sentinel state | grant/save/withdrawal |

## Commerce and dormant-state reconciliation

- Record the same bounded canonical product-price sample before and after deployment; every value must match.
- Confirm cart totals remain canonical, checkout rejects client-authoritative totals and the PesaPal amount source remains the committed order total without initiating payment.
- Confirm zero active new promotions, active new Experiments, customer-facing Automation, Survey invitations, PIM publications, Fraud auto-decline, automatic interventions, automatic Loyalty redemption and automatic Search synonym application.
- Confirm SMS/email/live-send gates false, dry-run true, and no outbox/provider/notification increase attributable to UAT.
- Confirm no order, payment, Inventory, fulfilment or consent lifecycle delta attributable to UAT.

## Soak checkpoints

At T+0, T+1, T+5, T+10, T+15, T+20 and T+30 record API/web health and IDs, restart counts, error/exit logs, database-client and UUID errors, worker/ticker/BullMQ/Redis health, queue depth, outbox retries, provider/notification attempts, DB pool health, CPU/memory, module-read health and the bounded price sample.
