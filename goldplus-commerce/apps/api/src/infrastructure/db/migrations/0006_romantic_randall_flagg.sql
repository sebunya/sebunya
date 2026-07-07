CREATE TABLE IF NOT EXISTS "cms_page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"excerpt" varchar(500),
	"meta_title" varchar(70),
	"meta_description" varchar(200),
	"edited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"excerpt" varchar(500),
	"meta_title" varchar(70),
	"meta_description" varchar(200),
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"publish_at" timestamp with time zone,
	"expire_at" timestamp with time zone,
	"current_version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"email" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_page_revisions_page_version_unique" ON "cms_page_revisions" ("page_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_provider_unique" ON "user_identities" ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_user_provider_unique" ON "user_identities" ("user_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_identities_user_idx" ON "user_identities" ("user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_page_revisions" ADD CONSTRAINT "cms_page_revisions_page_id_cms_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "cms_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_page_revisions" ADD CONSTRAINT "cms_page_revisions_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
