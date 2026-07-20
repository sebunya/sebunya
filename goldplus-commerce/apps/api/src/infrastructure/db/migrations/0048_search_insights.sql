CREATE TABLE IF NOT EXISTS "search_product_insights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "query" varchar(120) NOT NULL,
  "product_id" uuid NOT NULL,
  "impression_count" integer DEFAULT 0 NOT NULL,
  "click_count" integer DEFAULT 0 NOT NULL,
  "conversion_count" integer DEFAULT 0 NOT NULL,
  "rank_sum" integer DEFAULT 0 NOT NULL,
  "last_rank" integer NOT NULL,
  "first_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "search_product_insight_integrity" CHECK (
    "impression_count" >= 0 AND "click_count" >= 0 AND "conversion_count" >= 0
    AND "click_count" <= "impression_count"
    AND "conversion_count" <= "click_count"
    AND "last_rank" BETWEEN 1 AND 50 AND "rank_sum" >= "impression_count"
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "search_product_insight_query_product_idx"
  ON "search_product_insights" ("query", "product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_product_insight_product_idx"
  ON "search_product_insights" ("product_id");
--> statement-breakpoint
ALTER TABLE "search_product_insights"
  ADD CONSTRAINT "search_product_insights_query_fk"
  FOREIGN KEY ("query") REFERENCES "search_demand_signals"("query") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "search_product_insights"
  ADD CONSTRAINT "search_product_insights_product_fk"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;
