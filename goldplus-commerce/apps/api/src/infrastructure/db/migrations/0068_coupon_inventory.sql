-- U1 §12 — first-class coupon-code inventory (coupon_codes, coupon_redemptions).
--
-- WHY
-- promotion_versions.coupon_code holds exactly ONE code per version. A bulk batch
-- of thousands of single-use codes (AC8) with an individual redemption counter
-- and an exactly-once redemption gate (AC3) needs its own inventory. A coupon
-- belongs to a promotion (definition); redemption resolves the active version.
--
-- The single-use gate is a CONDITIONAL UPDATE on redemption_count (never
-- read-then-write) plus the unique (coupon_id, order_id) redemption index — see
-- the coupon redemption service. No dealer/supplier data stored here.
--
-- LOCK RISK: additive (two new tables + indexes). Safe online.

CREATE TABLE coupon_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_definition_id uuid NOT NULL REFERENCES promotion_definitions(id),
  code varchar(60) NOT NULL,
  code_normalised varchar(60) NOT NULL,
  code_type varchar(24) NOT NULL DEFAULT 'bulk_batch',
  batch_id uuid,
  assigned_to_customer_id uuid,
  assigned_to_creator_id uuid,                -- forward-compat: U4 creator codes
  max_redemptions integer,                    -- null = unlimited
  redemption_count integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupon_codes_code_type_chk CHECK (code_type IN ('public','single_use','personalised','creator','bulk_batch')),
  CONSTRAINT coupon_codes_max_redemptions_chk CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  CONSTRAINT coupon_codes_redemption_count_chk CHECK (redemption_count >= 0)
);

CREATE UNIQUE INDEX coupon_codes_code_normalised_idx ON coupon_codes (code_normalised);
CREATE INDEX coupon_codes_promotion_active_idx ON coupon_codes (promotion_definition_id, is_active);
CREATE INDEX coupon_codes_batch_idx ON coupon_codes (batch_id);

CREATE TABLE coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES coupon_codes(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  customer_identity_hash varchar(64) NOT NULL,
  discount_amount_ugx bigint NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  was_reversed boolean NOT NULL DEFAULT false,
  reversed_at timestamptz
);

-- One redemption row per (coupon, order): a retried checkout for the same order
-- cannot redeem the same coupon twice.
CREATE UNIQUE INDEX coupon_redemptions_coupon_order_idx ON coupon_redemptions (coupon_id, order_id);
CREATE INDEX coupon_redemptions_identity_idx ON coupon_redemptions (customer_identity_hash, redeemed_at);
