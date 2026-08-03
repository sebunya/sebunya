-- Wave 2E-3 — operator wording overrides for transactional notifications.
--
-- WHY
-- Every subject/preheader/headline was code-baked in NotificationTemplateRenderer,
-- so changing one word of customer-facing wording was a build-and-release. This
-- table holds per-template overrides with a draft->publish step; code strings stay
-- the canonical fallback (a missing/partial override falls through per FIELD), so
-- the sender can never render blank wording.
--
-- LOCK RISK: one new table, additive, safe online.

CREATE TABLE IF NOT EXISTS "notification_template_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_key" varchar(50) NOT NULL,
  "subject" varchar(200),
  "preheader" varchar(300),
  "headline" varchar(200),
  "status" varchar(12) DEFAULT 'DRAFT' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_template_overrides_key_status_uq" ON "notification_template_overrides" ("template_key","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_template_overrides_key_idx" ON "notification_template_overrides" ("template_key");
