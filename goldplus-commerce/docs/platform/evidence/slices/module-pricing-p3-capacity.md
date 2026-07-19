# Pricing P3 — promotion reservations and limits

- Base: clean/pushed P2 `2e80bd8c44d4433e5e56ee1dd71a7cd981a0b5c1`; clean repository suite green.
- One transactional adapter uses the existing 0042 quote/reservation/redemption tables. No migration changed and no second capacity ledger was created.
- Reservation locks each immutable promotion version in stable ID order with PostgreSQL transaction advisory locks. Expired holds are marked `EXPIRED` before counting. Active definition/version, effective window and quote expiry are revalidated before capacity is consumed.
- Version-global, customer and coupon limits count live reservations plus redemptions. Missing customer/coupon scope fails closed when the corresponding policy requires it. Quote preview and `persist:false` simulation never call the capacity port.
- Checkout idempotency reuses the same reservation set. Redemption inserts one row per reservation and changes status once; same-order retry is a duplicate, while a different order conflicts. Release changes only live `RESERVED` rows and repeated release is a duplicate.
- Real PostgreSQL proof: two final-global-slot contenders → one winner; two same-customer contenders → one winner; two same-coupon contenders → one winner; checkout retry reused the original row; redemption retry left one redemption; release retry performed one transition; zero orphan reservations/redemptions; no negative-capacity representation; zero provider calls and zero proof residue.
- Gates: Pricing focused plus architecture 21/21, workspace typecheck/build, secret scan, changed-path lint with zero errors and `git diff --check` pass.
- Status remains `SOURCE_PARTIAL`; P4 authoritative checkout, immutable order snapshot and PesaPal integrity is next. No production migration/deployment or live activity occurred.
