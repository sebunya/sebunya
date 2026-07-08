CREATE TABLE IF NOT EXISTS "product_finder_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anonymous_id" varchar(160),
	"status" varchar(50) DEFAULT 'FINDER_STARTED' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_finder_sessions_user_idx" ON "product_finder_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_finder_sessions_anonymous_idx" ON "product_finder_sessions" ("anonymous_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_finder_sessions" ADD CONSTRAINT "product_finder_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
