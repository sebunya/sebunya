-- 0092: Delivery estimation foundation (brief v7, stage A).
--
-- Schema for the ONE quoting service. Nothing here computes a fee — this is
-- the data the model in docs/delivery/MODEL.md reads, plus the capture the
-- calibration in PART 4 needs from the very first delivery.
--
-- TWO THINGS MOVED INTO THIS STAGE ON ROB'S INSTRUCTION (2026-08-05):
--   * rider cost capture. It is recorded nowhere today, which makes the whole
--     PART 4 learning design dead unless capture exists from the first
--     delivery. Deferring it to stage D would have meant the first weeks of
--     real deliveries taught us nothing.
--   * East Africa Time is a primitive and shipped as code (packages/shared/
--     src/time/eat.ts), not schema — noted here because every timestamp in
--     these tables is compared in EAT by the readers.
--
-- NO INVENTED NUMBERS. Every configuration value ships NULL or neutral:
--   * the six launch values are NULL and the module returns fee_unavailable
--   * corridor_factor / hour_factor / detour_factor default to 1.0, which
--     means "nothing learned yet" and is visible as such in admin
--   * the four PART 10 decisions are NULL and say so rather than defaulting
--
-- Additive and reversible.
-- Rollback: DROP TABLE delivery_quote_capture, delivery_learned_factor,
--   delivery_config_value, delivery_config_version, delivery_name_collision,
--   delivery_alias_corridor, delivery_corridor, delivery_origin. (Comment only.)

-- ── Origins ────────────────────────────────────────────────────────────────
-- Latitude/longitude are numeric, not float: a coordinate is a fact, and
-- 32.57750 must round-trip exactly. The Uganda bounding box is enforced in the
-- domain (DeliveryOrigin.ts) rather than as a CHECK so the failure carries a
-- diagnosis — OUTSIDE_UGANDA versus NULL_ISLAND are different bugs.
CREATE TABLE IF NOT EXISTS "delivery_origin" (
  "origin_code" varchar(40) PRIMARY KEY NOT NULL,
  "name" varchar(120) NOT NULL,
  "role" varchar(40) NOT NULL,
  "street" varchar(160),
  "landmark_primary" varchar(160),
  "landmark_secondary" varchar(160),
  "area_slug" varchar(160),
  "district" varchar(100),
  "corridor" varchar(40),
  "distance_band" varchar(4),
  "latitude" numeric(9,6) NOT NULL,
  "longitude" numeric(9,6) NOT NULL,
  "coord_source" varchar(60),
  "coord_anchor" varchar(300),
  "coord_confidence" varchar(60),
  "active" boolean DEFAULT false NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_origin_active_idx" ON "delivery_origin" ("active");
--> statement-breakpoint

-- ── Corridors: the 362-area metro set ──────────────────────────────────────
-- corridor and distance_band are NOT NULL: PART 9 #9 requires that no metro
-- area exists without them, and the database is the right place to make that
-- unreachable rather than a check someone can forget.
CREATE TABLE IF NOT EXISTS "delivery_corridor" (
  "area_slug" varchar(160) PRIMARY KEY NOT NULL,
  "postcode" varchar(8),
  "delivery_zone" varchar(4),
  "district" varchar(100) NOT NULL,
  "sub_county_or_division" varchar(160),
  "area" varchar(160) NOT NULL,
  "corridor" varchar(40) NOT NULL,
  "distance_band" varchar(4) NOT NULL,
  "access_mode" varchar(16) NOT NULL,
  "assignment_confidence" varchar(16),
  "assignment_basis" varchar(24),
  /** Ops may mark an area unserviceable; it then gets no quote at any price. */
  "serviceable" boolean DEFAULT true NOT NULL,
  /** Measured centroid, when one exists. Beats the band midpoint (MODEL 3.5). */
  "centroid_lat" numeric(9,6),
  "centroid_lng" numeric(9,6),
  "centroid_source" varchar(24),
  "centroid_sample_size" integer DEFAULT 0 NOT NULL,
  "data_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_corridor_access_check" CHECK ("access_mode" in ('road', 'water')),
  CONSTRAINT "delivery_corridor_band_check" CHECK ("distance_band" in ('B0','B1','B2','B3','B4','B5','B6')),
  CONSTRAINT "delivery_corridor_centroid_check"
    CHECK (("centroid_lat" IS NULL) = ("centroid_lng" IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_corridor_corridor_idx" ON "delivery_corridor" ("corridor");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_corridor_band_idx" ON "delivery_corridor" ("distance_band");
--> statement-breakpoint

-- ── Alias corridors ────────────────────────────────────────────────────────
-- Not derivable from the anchor: 5 of the 28 carry a band that DIFFERS from
-- their anchor area, so this is its own layer.
CREATE TABLE IF NOT EXISTS "delivery_alias_corridor" (
  "alias" varchar(120) PRIMARY KEY NOT NULL,
  "alias_type" varchar(40) NOT NULL,
  "district" varchar(100) NOT NULL,
  "anchor_area_in_gazetteer" varchar(160),
  "anchor_postcode" varchar(8),
  "anchor_area_slug" varchar(160) NOT NULL,
  "corridor" varchar(40) NOT NULL,
  "distance_band" varchar(4) NOT NULL,
  "band_confidence" varchar(16),
  "differs_from_anchor" boolean DEFAULT false NOT NULL,
  "note" text,
  "data_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "delivery_alias_band_check" CHECK ("distance_band" in ('B0','B1','B2','B3','B4','B5','B6'))
);
--> statement-breakpoint

-- ── Name collisions ────────────────────────────────────────────────────────
-- 84 rows in three classes. The routing rule is data, not code, so an operator
-- reading the table can see exactly why a term resolves the way it does.
CREATE TABLE IF NOT EXISTS "delivery_name_collision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "collision_type" varchar(48) NOT NULL,
  "colliding_name" varchar(160) NOT NULL,
  "district_with_that_name" varchar(100),
  "area_sits_in_district" varchar(100) NOT NULL,
  "sub_county" varchar(160),
  "postcode" varchar(8),
  "area_slug" varchar(160) NOT NULL,
  "delivery_zone" varchar(4),
  "routing_rule" text,
  "data_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "delivery_name_collision_type_check" CHECK ("collision_type" in (
    'AREA_NAME_MATCHES_OTHER_DISTRICT',
    'SUBCOUNTY_NAME_MATCHES_OTHER_DISTRICT',
    'AREA_NAME_MATCHES_OWN_DISTRICT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_name_collision_uq"
  ON "delivery_name_collision" ("collision_type", "colliding_name", "area_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_name_collision_name_idx"
  ON "delivery_name_collision" (lower("colliding_name"));
--> statement-breakpoint

-- ── Configuration: versions and values ─────────────────────────────────────
-- Every value the Control Centre can write lives here, and only keys declared
-- in the code registry may be written (PART 6). A version is immutable once
-- published, which is what makes revert one action.
CREATE TABLE IF NOT EXISTS "delivery_config_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" varchar(12) DEFAULT 'draft' NOT NULL,
  "reason" varchar(500),
  "created_by" uuid,
  "published_by" uuid,
  "published_at" timestamp with time zone,
  /** Scheduled publish time, compared in EAT by the reader. */
  "scheduled_for" timestamp with time zone,
  "reverted_from" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_config_version_status_check"
    CHECK ("status" in ('draft', 'scheduled', 'published', 'superseded', 'reverted')),
  -- A published version must say who published it and why. Nothing takes
  -- effect from typing.
  CONSTRAINT "delivery_config_version_publish_check"
    CHECK ("status" <> 'published' OR ("published_by" IS NOT NULL AND "published_at" IS NOT NULL AND "reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_config_version_status_idx" ON "delivery_config_version" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "delivery_config_value" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "delivery_config_version"("id") ON DELETE cascade,
  "config_key" varchar(80) NOT NULL,
  /** Stored as text and parsed against the registry's declared type. */
  "config_value" text,
  /** Who put this number here: a person, or the nightly model. */
  "origin" varchar(16) DEFAULT 'human' NOT NULL,
  "sample_size" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_config_value_origin_check" CHECK ("origin" in ('human', 'model_proposed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_config_value_uq"
  ON "delivery_config_value" ("version_id", "config_key");
--> statement-breakpoint

-- ── Learned factors ────────────────────────────────────────────────────────
-- Every factor ships at 1.0 with sample_size 0, which means "nothing learned
-- yet" and must be visible as such (PART 9 #3). Shrinkage toward the prior is
-- one formula in the domain, applied to every row here without special cases.
CREATE TABLE IF NOT EXISTS "delivery_learned_factor" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "factor_kind" varchar(24) NOT NULL,
  /** corridor code, area_slug, or hour-of-week key depending on kind. */
  "scope_key" varchar(160) NOT NULL,
  "value" numeric(8,4) DEFAULT 1.0 NOT NULL,
  "sample_size" integer DEFAULT 0 NOT NULL,
  "origin" varchar(16) DEFAULT 'prior' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_learned_factor_kind_check"
    CHECK ("factor_kind" in ('corridor_factor', 'hour_factor', 'detour_factor', 'last_mile_minutes')),
  CONSTRAINT "delivery_learned_factor_origin_check"
    CHECK ("origin" in ('prior', 'fitted', 'human')),
  CONSTRAINT "delivery_learned_factor_sample_check" CHECK ("sample_size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_learned_factor_uq"
  ON "delivery_learned_factor" ("factor_kind", "scope_key");
--> statement-breakpoint

-- ── Calibration capture, including RIDER COST ──────────────────────────────
-- One row per delivery, written from the first delivery onward. Everything
-- PART 4 asks to capture is a column here; the ones that are not known yet are
-- NULL rather than zero, because zero is a measurement and NULL is an absence.
CREATE TABLE IF NOT EXISTS "delivery_quote_capture" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "area_slug" varchar(160),
  "alias_used" varchar(120),
  "corridor" varchar(40),
  "distance_band" varchar(4),
  "quoted_fee_ugx" bigint,
  "final_fee_ugx" bigint,
  "variance_reason" varchar(48),
  /** What the delivery ACTUALLY cost. Entered by ops; NULL until known. */
  "actual_rider_cost_ugx" bigint,
  "expected_minutes" numeric(8,2),
  "actual_minutes" numeric(8,2),
  "dispatched_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "had_pin" boolean,
  "first_attempt_success" boolean,
  "distance_travelled_km" numeric(8,2),
  /** Which centroid source priced it, so any quote is explainable (PART 9 #37). */
  "centroid_source" varchar(24),
  "config_version_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_quote_capture_cost_check"
    CHECK ("actual_rider_cost_ugx" IS NULL OR "actual_rider_cost_ugx" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_quote_capture_order_uq" ON "delivery_quote_capture" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_quote_capture_area_idx" ON "delivery_quote_capture" ("area_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_quote_capture_delivered_idx" ON "delivery_quote_capture" ("delivered_at");
