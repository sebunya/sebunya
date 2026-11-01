-- §6 completion — governed admin-user creation + maker/checker for the full-admin role.
--
-- WHY
-- No endpoint could create an admin user or assign a role (admin/users was
-- read-only; roles existed only via the boot sync). Granting PLATFORM_ADMINISTRATOR
-- must never be a single person's act: a grant becomes a PENDING request that a
-- DIFFERENT administrator approves. Lesser governance roles assign directly
-- (audited) — that is what unblocks the legal reviewer without weakening the
-- two-person rule where it matters.
--
-- LOCK RISK: one new table, additive, safe online.

CREATE TABLE IF NOT EXISTS "role_grant_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "role_name" varchar(50) NOT NULL,
  "status" varchar(12) DEFAULT 'PENDING' NOT NULL,
  "requested_by" uuid NOT NULL,
  "decided_by" uuid,
  "reason" varchar(500),
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_grant_requests_status_idx" ON "role_grant_requests" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_grant_requests_user_idx" ON "role_grant_requests" ("user_id");
