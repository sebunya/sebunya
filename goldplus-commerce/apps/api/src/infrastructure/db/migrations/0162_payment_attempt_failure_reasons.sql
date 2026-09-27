-- 0162 — Why a payment attempt failed (2026-09-27).
--
-- payment_attempts kept no failure reason: the admin queue could only show
-- Pesapal's live description, fetched per row. Verification now records the
-- provider's status code and description when an attempt resolves to a
-- non-paid terminal state (failed / invalid / reversed), never on a completed
-- attempt. Attempt numbers are computed at read time and are not stored.
--
-- Additive, nullable, idempotent. Rollback: drop the three columns.
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS provider_status_code integer;
--> statement-breakpoint
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS provider_status_description text;
--> statement-breakpoint
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS failed_at timestamp with time zone;
