-- 0164 — Who lifted a suppression, when and why (2026-09-30).
--
-- A suppression could be recorded but never ended. Lifting one re-opens
-- marketing to a contact who once said STOP, so the evidence is kept on the
-- row itself and written in the same statement that deactivates it: it cannot
-- be lost the way a separate audit-log write can. The audit log still gets a
-- row; this is the record that cannot be missing.
--
-- Additive, nullable, idempotent. Rollback: drop the three columns.
ALTER TABLE channel_suppressions ADD COLUMN IF NOT EXISTS lifted_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE channel_suppressions ADD COLUMN IF NOT EXISTS lifted_by varchar(255);
--> statement-breakpoint
ALTER TABLE channel_suppressions ADD COLUMN IF NOT EXISTS lift_reason text;
