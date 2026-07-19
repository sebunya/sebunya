# Pricing P2 — deterministic evaluation and explainable quotes

- Base: clean/pushed P1 `873d965542fd37212bc05db50470e0fea5013c93` with a 194-file / 4,030-test clean suite.
- One pure evaluator sorts candidates by priority, definition ID and version number; database return order cannot change the result. It limits application to ten rules and defines stackable/exclusive closure explicitly.
- `EvaluateCartPricingUseCase` accepts only product IDs and quantities, consolidates duplicates, reloads canonical catalogue prices, normalizes coupon input and hashes safe coupon/customer references. Customer DNA segments and immutable Experiment evidence can qualify a rule but cannot approve or activate it.
- Qualification and exclusion evidence covers coupon, product/category, Customer DNA segment, Experiment variant, effective window, stacking conflict, maximum-rules and no-discount outcomes.
- Percentage benefits use integer basis points and floor rounding. Fixed amount, fixed price and free shipping share deterministic target ordering, caps and non-negative price floors. Tax remains explicit zero unless supplied by a trusted caller; no tax policy was invented.
- Quotes contain canonical lines, base/final line amounts, adjustments, excluded candidates, immutable promotion version IDs, safe coupon reference, Experiment evidence, calculation version, evaluation/expiry times and the complete decision trace. Persisted JSONB is native.
- Real PostgreSQL proof loaded two actual canonical catalogue products through `DrizzleProductRepository`, loaded two active approved immutable versions, produced base `250000`, discount `30000`, final `230000`, persisted one quote/two lines/three adjustments, rehydrated version numbers, and repeated the totals in non-persistent simulation. Provider calls and proof residue were zero.
- Gates: Pricing focused plus architecture 18/18, workspace typecheck/build, secret scan, changed-path lint with zero errors and `git diff --check` pass. No migration changed and no reservation, redemption, order, payment, outbox or provider activity occurred.
- Status remains `SOURCE_PARTIAL`; P3 transactional capacity reservation/redemption is next.
