CREATE TABLE IF NOT EXISTS "recommendation_materialized_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement" varchar(80) NOT NULL,
	"context_key" varchar(255) NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rec_cache_placement_context_idx" ON "recommendation_materialized_cache" ("placement","context_key");