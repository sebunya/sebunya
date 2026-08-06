-- ═══════════════════════════════════════════════════════════════════════════
-- 0093 — Fulfilment modes, bus parcel shipping, and the destination skeleton
--
-- Commercial constraint of 2026-08-06. This corrects a FACT the model had
-- wrong, not a preference: outside Kampala and the Wakiso metro it is not
-- physically possible to send a rider. Upcountry goes by bus to a parcel
-- office, where the customer collects. Three of the eighteen real orders
-- (Arua, Abim, Adjumani) cannot be served by any path that assumes a boda.
--
-- ADDITIVE AND REVERSIBLE. Every statement is CREATE ... IF NOT EXISTS or
-- ADD COLUMN IF NOT EXISTS. Nothing is dropped, renamed or backfilled.
--
-- THIS MIGRATION CONTAINS NOT ONE INSERT, exactly like 0092. Every bus fee is
-- negotiated with a carrier and none has been agreed yet; a seeded fee would be
-- a number nobody negotiated, which the customer would be charged and the
-- carrier would not honour. The destination skeleton arrives through the
-- MD5-gated importer, and it arrives with every fee column NULL.
--
-- Rollback:
--   DROP TABLE delivery_bus_rate_card;
--   DROP TABLE delivery_bus_destination;
--   ALTER TABLE ug_pickup_point DROP COLUMN carrier, DROP COLUMN town,
--     DROP COLUMN district, DROP COLUMN departure_times,
--     DROP COLUMN collection_window, DROP COLUMN bus_route;
--   ALTER TABLE delivery_corridor DROP COLUMN fulfilment_mode;
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Fulfilment mode on the corridor set ────────────────────────────────────
-- NULLABLE ON PURPOSE. Null means "derive it" — from the band against
-- own_rider_max_band, from access_mode, from serviceable. A non-null value is
-- an operator's explicit override and always wins. Defaulting this column to
-- 'own_rider' would have asserted, for all 362 areas at once, a fact nobody
-- checked.
ALTER TABLE "delivery_corridor"
  ADD COLUMN IF NOT EXISTS "fulfilment_mode" varchar(16);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "delivery_corridor" ADD CONSTRAINT "delivery_corridor_fulfilment_mode_check"
    CHECK ("fulfilment_mode" is null or "fulfilment_mode" in ('own_rider','bus_parcel','pickup_only','unserviceable'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- ── Parcel offices ─────────────────────────────────────────────────────────
-- The location module's `ug_pickup_point` already models a place a customer
-- collects from, and already names `bus_parcel_office` as an operator kind.
-- Extending it keeps ONE table for "somewhere you collect"; a parallel table
-- would guarantee two answers to the same question.
ALTER TABLE "ug_pickup_point"
  ADD COLUMN IF NOT EXISTS "carrier" varchar(80),
  ADD COLUMN IF NOT EXISTS "town" varchar(120),
  ADD COLUMN IF NOT EXISTS "district" varchar(100),
  ADD COLUMN IF NOT EXISTS "departure_times" text,
  ADD COLUMN IF NOT EXISTS "collection_window" text,
  ADD COLUMN IF NOT EXISTS "bus_route" varchar(48);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_pickup_point_carrier_town_idx"
  ON "ug_pickup_point" ("carrier", "town");
--> statement-breakpoint

-- ── Bus destinations: the skeleton, without a single price ─────────────────
-- 128 towns across nine trunk routes, imported from the template. Mubende
-- appears on two routes (R7 and R8) because two trunk roads reach it, so the
-- key is (route, town) and NOT the district.
CREATE TABLE IF NOT EXISTS "delivery_bus_destination" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "route" varchar(48) NOT NULL,
  "destination_town" varchar(120) NOT NULL,
  "matching_district" varchar(100) NOT NULL,
  "region" varchar(60),
  "current_zone" varchar(4),
  "areas_in_district" integer,
  "notes" text,
  "data_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_bus_destination_uq"
  ON "delivery_bus_destination" ("route", "destination_town");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_bus_destination_district_idx"
  ON "delivery_bus_destination" ("matching_district");
--> statement-breakpoint

-- ── Bus rate cards ─────────────────────────────────────────────────────────
-- A negotiated price list, versioned and dated. `fee_ugx` is NOT NULL because a
-- card row exists only once a fee has actually been agreed — a card with a null
-- fee would be indistinguishable from no card at all, and the module's answer
-- to "no card" is to say so and use the manual path.
--
-- `insurance_pct_of_declared_value` IS nullable: a carrier offering no cover is
-- a different fact from a carrier offering cover at zero percent.
CREATE TABLE IF NOT EXISTS "delivery_bus_rate_card" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "carrier" varchar(80) NOT NULL,
  "destination_town" varchar(120) NOT NULL,
  "destination_district" varchar(100) NOT NULL,
  "parcel_class" varchar(8) NOT NULL,
  "fee_ugx" bigint NOT NULL,
  "insurance_pct_of_declared_value" numeric(6,3),
  "transit_days_min" integer NOT NULL,
  "transit_days_max" integer NOT NULL,
  "charged_at" varchar(12) NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "effective_to" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "source_note" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_bus_rate_card_class_check"
    CHECK ("parcel_class" in ('small','medium','large')),
  CONSTRAINT "delivery_bus_rate_card_charged_at_check"
    CHECK ("charged_at" in ('sending','collection')),
  CONSTRAINT "delivery_bus_rate_card_fee_check" CHECK ("fee_ugx" >= 0),
  CONSTRAINT "delivery_bus_rate_card_transit_check"
    CHECK ("transit_days_min" >= 0 and "transit_days_max" >= "transit_days_min"),
  -- An expiry before its own start would silently price nothing.
  CONSTRAINT "delivery_bus_rate_card_window_check"
    CHECK ("effective_to" is null or "effective_to" > "effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_bus_rate_card_uq"
  ON "delivery_bus_rate_card" ("carrier", "destination_town", "destination_district", "parcel_class", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_bus_rate_card_lookup_idx"
  ON "delivery_bus_rate_card" ("destination_town", "destination_district", "parcel_class");
--> statement-breakpoint

-- ── The quote records which card priced it ─────────────────────────────────
-- "A quote records which carrier and which card version priced it." Without
-- this a disputed shipping charge cannot be reproduced, because the card may
-- have been renegotiated since.
ALTER TABLE "delivery_quote_capture"
  ADD COLUMN IF NOT EXISTS "fulfilment_mode" varchar(16),
  ADD COLUMN IF NOT EXISTS "carrier" varchar(80),
  ADD COLUMN IF NOT EXISTS "rate_card_id" uuid,
  ADD COLUMN IF NOT EXISTS "rate_card_version" integer,
  ADD COLUMN IF NOT EXISTS "parcel_class" varchar(8),
  ADD COLUMN IF NOT EXISTS "parcel_office_id" uuid,
  -- Which path answered the customer, so the legacy fallback can be proven
  -- cold before it is deleted.
  ADD COLUMN IF NOT EXISTS "priced_by" varchar(24);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "delivery_quote_capture" ADD CONSTRAINT "delivery_quote_capture_priced_by_check"
    CHECK ("priced_by" is null or "priced_by" in ('delivery_model','bus_rate_card','legacy_fallback','manual'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
