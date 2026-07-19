# Pricing P1 — governed promotion domain

- Base: clean local/origin Experiments commit `97f304565679284e7bf6731f56d0183a6e7fd239`.
- Boundary: pure Pricing governance, port/use case, Drizzle adapter and native-JSONB codec, additive migration 0042, focused tests and a self-cleaning PostgreSQL proof. Checkout, payment, Inventory, fulfilment, Customer DNA, Experiments, Automation, Decision Intelligence, providers and production were not changed or invoked.
- Canonical prices remain in the existing catalogue. Pricing rules carry only conditions, benefits, exclusions, effective windows, usage limits, stacking/priority and price-floor policy; they do not duplicate product prices.
- Supported benefits are deliberately limited to percentage-off (basis points), fixed-amount-off, fixed-price and free-shipping. Money remains integer UGX. No bundle/BOGO semantics were invented.
- Lifecycle is `DRAFT → READY_FOR_REVIEW → APPROVED → ACTIVE ↔ PAUSED`, with explicit rejection, expiry and archive paths. Direct activation is denied. Activation checks the approved immutable version and its effective window. Deployment/migration creates no active definition.
- Migration 0042 is additive and forward-complete for P1–P4 persistence: governed definitions/versions/approvals, quotes/lines/adjustments, reservation/redemption primitives, Experiment association, and nullable/defaulted immutable order-pricing provenance. Migrations 0000–0041 are unchanged.
- Fresh PostgreSQL replay produced 43 journal rows, nine Pricing tables, eleven order/order-line Pricing columns and zero active promotions. The populated continuation database upgraded from 0041 to 0042 successfully.
- Real-PG verdict: `DRAFT->READY_FOR_REVIEW->APPROVED->ACTIVE->PAUSED`; direct activation denied; one approval; five audit entries; conditions/benefits/exclusions persisted as native JSONB arrays; zero provider calls; zero proof residue; PASS.
- Gates: focused Pricing plus architecture 14/14; workspace typecheck, API/Astro build, secret scan, changed-path lint and `git diff --check` pass. The dirty-tree full suite has only the established historical artifact-allowlist failures; it must be rerun clean after this commit.
- Status: Pricing & Promotions is `SOURCE_PARTIAL`. P2 deterministic evaluation is next. No production migration/deployment or `LIVE_VERIFIED` claim occurred.
