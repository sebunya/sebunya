-- Wave 2C — governed legal-policy CMS.
--
-- WHY
-- Legal wording lived in source (apps/web/src/pages/*.astro + a static registry),
-- so every wording change was a code deployment and no review/approval trail
-- existed. These tables hold append-only versioned policy text with a governed
-- lifecycle (draft -> review -> approve[maker/checker] -> schedule/publish ->
-- rollback-by-repointing); the public pages keep their truthful interim static
-- wording as fallback until a version is PUBLISHED.
--
-- LOCK RISK: two new tables, additive only, safe online.

CREATE TABLE IF NOT EXISTS "legal_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(40) NOT NULL,
  "title" varchar(200) NOT NULL,
  "current_version_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legal_policies_key_uq" ON "legal_policies" ("key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legal_policy_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "policy_id" uuid NOT NULL REFERENCES "legal_policies"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "title" varchar(200) NOT NULL,
  "body_markdown" text NOT NULL,
  "change_note" varchar(500),
  "status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
  "effective_at" timestamp with time zone,
  "seo_title" varchar(200),
  "seo_description" varchar(300),
  "locale" varchar(10) DEFAULT 'en' NOT NULL,
  "created_by" uuid,
  "approved_by" uuid,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legal_policy_versions_policy_version_uq" ON "legal_policy_versions" ("policy_id","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legal_policy_versions_policy_idx" ON "legal_policy_versions" ("policy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legal_policy_versions_status_idx" ON "legal_policy_versions" ("status");
