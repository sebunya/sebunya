CREATE TABLE IF NOT EXISTS "promotion_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(80) NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text NOT NULL,
  "status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "active_version_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "promotion_definitions_status_check" CHECK ("status" IN ('DRAFT','READY_FOR_REVIEW','APPROVED','ACTIVE','PAUSED','EXPIRED','REJECTED','ARCHIVED')),
  CONSTRAINT "promotion_definitions_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promotion_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "definition_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
  "conditions" jsonb NOT NULL,
  "benefits" jsonb NOT NULL,
  "exclusions" jsonb NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "global_limit" integer,
  "per_customer_limit" integer,
  "per_coupon_limit" integer,
  "reservation_ttl_seconds" integer DEFAULT 900 NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "stackable" boolean DEFAULT false NOT NULL,
  "coupon_code" varchar(40),
  "price_floor_ugx" integer DEFAULT 0 NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "submitted_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "approved_by" uuid,
  CONSTRAINT "promotion_versions_status_check" CHECK ("status" IN ('DRAFT','READY_FOR_REVIEW','APPROVED','ACTIVE','PAUSED','EXPIRED','REJECTED','ARCHIVED')),
  CONSTRAINT "promotion_versions_window_check" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "promotion_versions_limits_check" CHECK (("global_limit" IS NULL OR "global_limit" > 0) AND ("per_customer_limit" IS NULL OR "per_customer_limit" > 0) AND ("per_coupon_limit" IS NULL OR "per_coupon_limit" > 0)),
  CONSTRAINT "promotion_versions_policy_check" CHECK ("version_number" > 0 AND "reservation_ttl_seconds" BETWEEN 60 AND 86400 AND "priority" BETWEEN 0 AND 10000 AND "price_floor_ugx" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promotion_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL,
  "decision" varchar(20) NOT NULL,
  "actor_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "promotion_approvals_decision_check" CHECK ("decision" IN ('APPROVED','REJECTED')),
  CONSTRAINT "promotion_approvals_reason_check" CHECK (length(trim("reason")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promotion_definitions_key_idx" ON "promotion_definitions" ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotion_definitions_status_idx" ON "promotion_definitions" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promotion_versions_definition_number_idx" ON "promotion_versions" ("definition_id", "version_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotion_versions_coupon_idx" ON "promotion_versions" ("coupon_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotion_versions_status_window_idx" ON "promotion_versions" ("status", "starts_at", "ends_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotion_approvals_version_idx" ON "promotion_approvals" ("version_id", "decided_at");
--> statement-breakpoint
ALTER TABLE "promotion_versions" ADD CONSTRAINT "promotion_versions_definition_fk" FOREIGN KEY ("definition_id") REFERENCES "promotion_definitions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promotion_approvals" ADD CONSTRAINT "promotion_approvals_version_fk" FOREIGN KEY ("version_id") REFERENCES "promotion_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promotion_definitions" ADD CONSTRAINT "promotion_definitions_active_version_fk" FOREIGN KEY ("active_version_id") REFERENCES "promotion_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "currency" varchar(3) DEFAULT 'UGX' NOT NULL,
  "customer_scope_hash" varchar(64),
  "coupon_reference" varchar(64),
  "base_subtotal_ugx" integer NOT NULL,
  "discount_total_ugx" integer DEFAULT 0 NOT NULL,
  "shipping_ugx" integer DEFAULT 0 NOT NULL,
  "tax_ugx" integer DEFAULT 0 NOT NULL,
  "final_total_ugx" integer NOT NULL,
  "calculation_version" varchar(40) NOT NULL,
  "experiment_evidence" jsonb NOT NULL,
  "decision_trace" jsonb NOT NULL,
  "evaluated_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "pricing_quotes_money_check" CHECK ("base_subtotal_ugx" >= 0 AND "discount_total_ugx" >= 0 AND "shipping_ugx" >= 0 AND "tax_ugx" >= 0 AND "final_total_ugx" >= 0),
  CONSTRAINT "pricing_quotes_currency_check" CHECK ("currency" = 'UGX'),
  CONSTRAINT "pricing_quotes_expiry_check" CHECK ("expires_at" > "evaluated_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_quote_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "sku" varchar(50) NOT NULL,
  "product_name" varchar(255) NOT NULL,
  "quantity" integer NOT NULL,
  "canonical_unit_price_ugx" integer NOT NULL,
  "base_subtotal_ugx" integer NOT NULL,
  "discount_ugx" integer DEFAULT 0 NOT NULL,
  "final_subtotal_ugx" integer NOT NULL,
  CONSTRAINT "pricing_quote_lines_money_check" CHECK ("quantity" > 0 AND "canonical_unit_price_ugx" > 0 AND "base_subtotal_ugx" >= 0 AND "discount_ugx" >= 0 AND "final_subtotal_ugx" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL,
  "quote_line_id" uuid,
  "promotion_definition_id" uuid NOT NULL,
  "promotion_version_id" uuid NOT NULL,
  "benefit_type" varchar(30) NOT NULL,
  "amount_ugx" integer NOT NULL,
  "application_order" integer NOT NULL,
  "explanation" text NOT NULL,
  CONSTRAINT "pricing_adjustments_amount_check" CHECK ("amount_ugx" >= 0 AND "application_order" >= 0),
  CONSTRAINT "pricing_adjustments_benefit_check" CHECK ("benefit_type" IN ('PERCENTAGE_OFF','FIXED_AMOUNT_OFF','FIXED_PRICE','FREE_SHIPPING'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promotion_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL,
  "promotion_version_id" uuid NOT NULL,
  "customer_scope_hash" varchar(64),
  "coupon_reference_hash" varchar(64),
  "idempotency_key" varchar(160) NOT NULL,
  "status" varchar(20) DEFAULT 'RESERVED' NOT NULL,
  "reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "released_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "promotion_reservations_status_check" CHECK ("status" IN ('RESERVED','REDEEMED','RELEASED','EXPIRED','CANCELLED')),
  CONSTRAINT "promotion_reservations_expiry_check" CHECK ("expires_at" > "reserved_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promotion_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reservation_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_experiment_associations" (
  "promotion_version_id" uuid NOT NULL,
  "experiment_id" uuid NOT NULL,
  "variant_key" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricing_quotes_expiry_idx" ON "pricing_quotes" ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pricing_quote_lines_quote_product_idx" ON "pricing_quote_lines" ("quote_id", "product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricing_adjustments_quote_idx" ON "pricing_adjustments" ("quote_id", "application_order");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promotion_reservations_idempotency_idx" ON "promotion_reservations" ("idempotency_key", "promotion_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotion_reservations_capacity_idx" ON "promotion_reservations" ("promotion_version_id", "status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotion_reservations_customer_idx" ON "promotion_reservations" ("promotion_version_id", "customer_scope_hash", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotion_reservations_coupon_idx" ON "promotion_reservations" ("promotion_version_id", "coupon_reference_hash", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promotion_redemptions_reservation_idx" ON "promotion_redemptions" ("reservation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promotion_redemptions_order_reservation_idx" ON "promotion_redemptions" ("order_id", "reservation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pricing_experiment_associations_idx" ON "pricing_experiment_associations" ("promotion_version_id", "experiment_id", "variant_key");
--> statement-breakpoint
ALTER TABLE "pricing_quote_lines" ADD CONSTRAINT "pricing_quote_lines_quote_fk" FOREIGN KEY ("quote_id") REFERENCES "pricing_quotes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_adjustments" ADD CONSTRAINT "pricing_adjustments_quote_fk" FOREIGN KEY ("quote_id") REFERENCES "pricing_quotes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_adjustments" ADD CONSTRAINT "pricing_adjustments_line_fk" FOREIGN KEY ("quote_line_id") REFERENCES "pricing_quote_lines"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_adjustments" ADD CONSTRAINT "pricing_adjustments_definition_fk" FOREIGN KEY ("promotion_definition_id") REFERENCES "promotion_definitions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_adjustments" ADD CONSTRAINT "pricing_adjustments_version_fk" FOREIGN KEY ("promotion_version_id") REFERENCES "promotion_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promotion_reservations" ADD CONSTRAINT "promotion_reservations_quote_fk" FOREIGN KEY ("quote_id") REFERENCES "pricing_quotes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promotion_reservations" ADD CONSTRAINT "promotion_reservations_version_fk" FOREIGN KEY ("promotion_version_id") REFERENCES "promotion_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "promotion_reservations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_order_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_experiment_associations" ADD CONSTRAINT "pricing_experiment_associations_version_fk" FOREIGN KEY ("promotion_version_id") REFERENCES "promotion_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_experiment_associations" ADD CONSTRAINT "pricing_experiment_associations_experiment_fk" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pricing_quote_id" uuid;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pricing_currency" varchar(3) DEFAULT 'UGX' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pricing_base_subtotal" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pricing_discount_total" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pricing_tax_total" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pricing_calculation_version" varchar(40) DEFAULT 'legacy-unadjusted-v1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pricing_snapshot" jsonb;
--> statement-breakpoint
UPDATE "orders" SET "pricing_base_subtotal" = "subtotal_amount" WHERE "pricing_base_subtotal" = 0 AND "subtotal_amount" > 0;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pricing_quote_fk" FOREIGN KEY ("pricing_quote_id") REFERENCES "pricing_quotes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pricing_money_check" CHECK ("pricing_currency" = 'UGX' AND "pricing_base_subtotal" >= 0 AND "pricing_discount_total" >= 0 AND "pricing_tax_total" >= 0);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "canonical_unit_price" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "base_subtotal" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "discount_amount" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "final_line_total" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "order_items" SET "canonical_unit_price" = "unit_price", "base_subtotal" = "unit_price" * "quantity", "final_line_total" = "unit_price" * "quantity" WHERE "canonical_unit_price" = 0;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_pricing_money_check" CHECK ("canonical_unit_price" >= 0 AND "base_subtotal" >= 0 AND "discount_amount" >= 0 AND "final_line_total" >= 0);
