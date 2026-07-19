CREATE TABLE IF NOT EXISTS "fulfilment_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fulfilment_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(140) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fulfilment_tasks" ADD COLUMN "team_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fulfilment_team_members_team_user_idx" ON "fulfilment_team_members" ("team_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_team_members_user_idx" ON "fulfilment_team_members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fulfilment_teams_slug_idx" ON "fulfilment_teams" ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_tasks_team_idx" ON "fulfilment_tasks" ("team_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_team_members" ADD CONSTRAINT "fulfilment_team_members_team_id_fulfilment_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "fulfilment_teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_team_members" ADD CONSTRAINT "fulfilment_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
