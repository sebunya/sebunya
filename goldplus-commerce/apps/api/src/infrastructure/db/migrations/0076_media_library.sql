-- Wave 2B — media library (DAM) on top of the existing product-image owner.
--
-- WHY
-- Product image upload existed (IProductImageStorage -> web/public) but production
-- runs api and web as separate containers with NO shared volume and nothing serving
-- /uploads, so uploads landed on an ephemeral container filesystem and their URLs
-- 404'd: a write-only black hole. The compose/Caddy change (same wave) gives storage
-- a durable shared volume served by the edge; these tables give assets a canonical,
-- checksum-deduplicated record with metadata, variants and a usage graph so deletion
-- can refuse while anything still references the file.
--
-- LOCK RISK: three new tables plus one nullable FK column on product_images —
-- additive only, no rewrites, safe online.

CREATE TABLE IF NOT EXISTS "media_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "filename" varchar(300) NOT NULL,
  "mime" varchar(100) NOT NULL,
  "byte_size" bigint NOT NULL,
  "width" integer,
  "height" integer,
  "checksum_sha256" varchar(64) NOT NULL,
  "storage_key" varchar(500) NOT NULL,
  "url" varchar(600) NOT NULL,
  "alt_text" varchar(255),
  "caption" varchar(500),
  "rights" varchar(300),
  "rights_expires_at" timestamp with time zone,
  "focal_x" double precision,
  "focal_y" double precision,
  "status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_checksum_uq" ON "media_assets" ("checksum_sha256");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_assets_status_idx" ON "media_assets" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_assets_created_idx" ON "media_assets" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_asset_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "purpose" varchar(30) NOT NULL,
  "format" varchar(10) NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "byte_size" bigint NOT NULL,
  "storage_key" varchar(500) NOT NULL,
  "url" varchar(600) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_asset_variants_asset_idx" ON "media_asset_variants" ("asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_asset_variants_purpose_uq" ON "media_asset_variants" ("asset_id","purpose","format");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_usages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "entity" varchar(50) NOT NULL,
  "entity_id" uuid NOT NULL,
  "field" varchar(50) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_usages_asset_idx" ON "media_usages" ("asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_usages_entity_idx" ON "media_usages" ("entity","entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_usages_uq" ON "media_usages" ("asset_id","entity","entity_id","field");
--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN IF NOT EXISTS "asset_id" uuid REFERENCES "media_assets"("id") ON DELETE SET NULL;
