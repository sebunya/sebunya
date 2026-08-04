-- Delivery intelligence — the band-pricing policy behind fee prediction.
--
-- WHY
-- delivery_zones holds operator-CONFIRMED fees, but it has been empty since
-- launch: nobody hand-enters 136 districts. Prediction inverts the work: road
-- geography is embedded in code as verified data, and this ONE row of eight
-- band prices (boda rings inside Greater Kampala, bus-parcel bands upcountry)
-- prices the whole country as ESTIMATES. Confirmed zones always override;
-- estimates never enter order totals.
--
-- Single-row by design: "singleton" is a fixed key with a unique index, so a
-- second policy cannot exist and every save is an audited replace.
--
-- LOCK RISK: one new table, additive, safe online.

CREATE TABLE IF NOT EXISTS "delivery_pricing_policy" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "singleton" varchar(10) DEFAULT 'policy' NOT NULL,
  "core_fee_ugx" bigint NOT NULL,
  "city_fee_ugx" bigint NOT NULL,
  "metro_fee_ugx" bigint NOT NULL,
  "metro_edge_fee_ugx" bigint NOT NULL,
  "near_fee_ugx" bigint NOT NULL,
  "mid_fee_ugx" bigint NOT NULL,
  "far_fee_ugx" bigint NOT NULL,
  "remote_fee_ugx" bigint NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "note" varchar(300),
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_pricing_policy_singleton_idx" ON "delivery_pricing_policy" ("singleton");
