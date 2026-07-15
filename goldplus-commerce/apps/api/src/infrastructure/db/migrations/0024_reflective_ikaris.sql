CREATE TABLE IF NOT EXISTS "search_demand_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" varchar(120) NOT NULL,
	"search_count" integer DEFAULT 0 NOT NULL,
	"zero_result_count" integer DEFAULT 0 NOT NULL,
	"last_result_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"first_searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "search_demand_query_idx" ON "search_demand_signals" ("query");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_demand_status_idx" ON "search_demand_signals" ("status");