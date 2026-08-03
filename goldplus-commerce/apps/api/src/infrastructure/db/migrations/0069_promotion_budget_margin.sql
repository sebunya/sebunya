-- U1 §12 — promotion budget cap (AC4) and margin-bps floor (AC5) on
-- promotion_versions.
--
-- WHY
-- Capacity was count-based only (global/per-customer/per-coupon limits). AC4
-- needs a UGX budget cap that auto-pauses the version when consumed; AC5 needs a
-- basis-point margin floor the evaluator enforces. Both are additive columns.
--
-- Budget is consumed atomically at redemption (redeemQuote); when consumption
-- reaches the cap the version status flips to PAUSED, so the existing
-- ACTIVE-only reservation guard and the ACTIVE-only candidate loader both stop
-- offering it — the order past the budget does not receive it.
--
-- LOCK RISK: additive columns with defaults that PostgreSQL fills without a
-- table rewrite (integer/bigint defaults are metadata-only since PG 11). Safe.

ALTER TABLE promotion_versions
  ADD COLUMN budget_cap_ugx bigint,
  ADD COLUMN budget_consumed_ugx bigint NOT NULL DEFAULT 0,
  ADD COLUMN min_margin_bps_floor integer;

ALTER TABLE promotion_versions
  ADD CONSTRAINT promotion_versions_budget_consumed_chk CHECK (budget_consumed_ugx >= 0),
  ADD CONSTRAINT promotion_versions_budget_cap_chk CHECK (budget_cap_ugx IS NULL OR budget_cap_ugx >= 0),
  ADD CONSTRAINT promotion_versions_margin_floor_chk CHECK (min_margin_bps_floor IS NULL OR (min_margin_bps_floor >= 0 AND min_margin_bps_floor <= 10000));
