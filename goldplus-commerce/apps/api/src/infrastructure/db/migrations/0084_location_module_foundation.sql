-- 0084: Location module foundation (location-module brief PARTs D–E, stage 2).
-- Additive and reversible. Reference tables are populated ONLY by the MD5-gated
-- import script; nothing here seeds gazetteer data. delivery_zone_policy is the
-- brief's `delivery_zone` renamed (the existing per-district delivery_zones owns
-- FEES per approved decision #7/Option A; this table owns non-fee policy) — all
-- policy values seeded NULL, activation blocked until ops sets every one.
-- Rollback: DROP TABLE ug_area_group_member, ug_area_group, ug_area_alias,
--   ug_landmark, ug_pickup_point, ug_search_miss, ug_data_exception,
--   delivery_zone_policy, address_audit, ug_area; ALTER TABLE addresses DROP the
--   0084 columns and SET user_id NOT NULL; ALTER TABLE orders restore
--   delivery_location from delivery_location_raw where raw IS NOT NULL then DROP
--   delivery_location_raw. (Comments only — never executed.)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ug_area" (
  "area_slug" varchar(160) PRIMARY KEY NOT NULL,
  "postcode" varchar(8),
  "parish_or_area_clean" varchar(160) NOT NULL,
  "parish_or_area_source" varchar(160),
  "display_label" varchar(220) NOT NULL,
  "current_district" varchar(100) NOT NULL,
  "district_2019_source" varchar(100),
  "district_changed" boolean DEFAULT false NOT NULL,
  "region" varchar(60),
  "county_or_municipality" varchar(120),
  "subcounty_or_division" varchar(120),
  "delivery_zone_code" varchar(8),
  "selectable" boolean DEFAULT true NOT NULL,
  "is_metro" boolean DEFAULT false NOT NULL,
  "search_text" text NOT NULL,
  "data_version" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_area_district_idx" ON "ug_area" ("current_district");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_area_zone_idx" ON "ug_area" ("delivery_zone_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_area_postcode_idx" ON "ug_area" ("postcode");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_area_search_trgm_idx" ON "ug_area" USING gin ("search_text" gin_trgm_ops);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ug_area_alias" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "alias" varchar(160) NOT NULL,
  "normalised_alias" varchar(160) NOT NULL,
  "area_slug" varchar(160) NOT NULL,
  "confidence" varchar(20) NOT NULL,
  "source" varchar(20) NOT NULL,
  "note" varchar(300),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ug_area_alias" ADD CONSTRAINT "ug_area_alias_area_slug_fk" FOREIGN KEY ("area_slug") REFERENCES "ug_area"("area_slug") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ug_area_alias_norm_area_idx" ON "ug_area_alias" ("normalised_alias","area_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_area_alias_norm_idx" ON "ug_area_alias" ("normalised_alias");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_area_alias_trgm_idx" ON "ug_area_alias" USING gin ("normalised_alias" gin_trgm_ops);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ug_area_group" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_name" varchar(120) NOT NULL,
  "normalised_name" varchar(120) NOT NULL,
  "district" varchar(100) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ug_area_group_name_idx" ON "ug_area_group" ("normalised_name","district");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ug_area_group_member" (
  "group_id" uuid NOT NULL,
  "area_slug" varchar(160) NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ug_area_group_member" ADD CONSTRAINT "ug_area_group_member_group_fk" FOREIGN KEY ("group_id") REFERENCES "ug_area_group"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ug_area_group_member" ADD CONSTRAINT "ug_area_group_member_area_fk" FOREIGN KEY ("area_slug") REFERENCES "ug_area"("area_slug") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ug_area_group_member_pair_idx" ON "ug_area_group_member" ("group_id","area_slug");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ug_data_exception" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "exception_type" varchar(60) NOT NULL,
  "district" varchar(100),
  "postcode" varchar(8),
  "area_ref" varchar(160),
  "description" text,
  "source_row" jsonb,
  "data_version" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ug_landmark" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "area_slug" varchar(160) NOT NULL,
  "name" varchar(160) NOT NULL,
  "landmark_type" varchar(30) NOT NULL,
  "usage_count" integer DEFAULT 0 NOT NULL,
  "verified" boolean DEFAULT false NOT NULL,
  "created_from_order_id" uuid,
  "gps_lat" double precision,
  "gps_lng" double precision,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ug_landmark" ADD CONSTRAINT "ug_landmark_area_slug_fk" FOREIGN KEY ("area_slug") REFERENCES "ug_area"("area_slug") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ug_landmark_area_name_idx" ON "ug_landmark" ("area_slug", lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_landmark_area_idx" ON "ug_landmark" ("area_slug");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ug_pickup_point" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(160) NOT NULL,
  "operator" varchar(30) NOT NULL,
  "area_slug" varchar(160),
  "physical_address" text,
  "landmark_text" text,
  "gps_lat" double precision,
  "gps_lng" double precision,
  "phone" varchar(20),
  "opening_hours" jsonb,
  "serves_districts" text[],
  "active" boolean DEFAULT false NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ug_pickup_point" ADD CONSTRAINT "ug_pickup_point_area_slug_fk" FOREIGN KEY ("area_slug") REFERENCES "ug_area"("area_slug") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_pickup_point_area_idx" ON "ug_pickup_point" ("area_slug");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ug_search_miss" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "raw_query" varchar(200) NOT NULL,
  "normalised_query" varchar(200) NOT NULL,
  "session_id" varchar(80),
  "customer_id" uuid,
  "result_count" integer DEFAULT 0 NOT NULL,
  "resolved_area_slug" varchar(160),
  "resolved_via" varchar(20),
  "device_hint" varchar(120),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_search_miss_norm_idx" ON "ug_search_miss" ("normalised_query");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ug_search_miss_created_idx" ON "ug_search_miss" ("created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "delivery_zone_policy" (
  "zone_code" varchar(8) PRIMARY KEY NOT NULL,
  "zone_name" varchar(80) NOT NULL,
  "sla_hours_min" integer,
  "sla_hours_max" integer,
  "fallback_fee_ugx" bigint,
  "free_delivery_threshold_ugx" bigint,
  "cod_allowed" boolean,
  "cod_max_order_value_ugx" bigint,
  "prepay_required_above_ugx" bigint,
  "carrier" varchar(30),
  "active" boolean DEFAULT false NOT NULL,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "delivery_zone_policy" ("zone_code","zone_name") VALUES
  ('Z1','Z1'), ('Z2','Z2'), ('Z3','Z3'), ('Z4','Z4')
ON CONFLICT ("zone_code") DO NOTHING;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "address_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "address_id" uuid,
  "order_id" uuid,
  "actor_type" varchar(20) NOT NULL,
  "actor_id" uuid,
  "action" varchar(40) NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "address_audit_address_idx" ON "address_audit" ("address_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "address_audit_order_idx" ON "address_audit" ("order_id");
--> statement-breakpoint

ALTER TABLE "addresses" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "area_slug" varchar(160);
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "area_group_id" uuid;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "landmark_text" text;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "additional_directions" text;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "phone_secondary" varchar(20);
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "gps_lat" double precision;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "gps_lng" double precision;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "gps_accuracy_m" real;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "gps_source" varchar(20);
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "gps_captured_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "raw_address_text" text;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "resolution_status" varchar(20) DEFAULT 'resolved' NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "delivery_method" varchar(20) DEFAULT 'door' NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "pickup_point_id" uuid;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "snapshot_area_label" varchar(220);
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "snapshot_district" varchar(100);
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "snapshot_postcode" varchar(8);
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "snapshot_data_version" integer;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint

-- Double-encoding repair for orders.delivery_location (ledger: jsonb rows hold a
-- JSON *string*). Original values preserved verbatim in delivery_location_raw —
-- this UPDATE changes encoding only, never meaning.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_location_raw" jsonb;
--> statement-breakpoint
UPDATE "orders"
SET "delivery_location_raw" = "delivery_location",
    "delivery_location" = ("delivery_location" #>> '{}')::jsonb
WHERE "delivery_location" IS NOT NULL
  AND jsonb_typeof("delivery_location") = 'string'
  AND ("delivery_location" #>> '{}') ~ '^\s*\{';
