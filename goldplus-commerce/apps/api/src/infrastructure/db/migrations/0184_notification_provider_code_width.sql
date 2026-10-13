-- 0184: notification_attempts.provider_code 50 -> 160 characters (owner, 2026-10-14: WhatsApp direct with Meta).
--
-- Meta's message id for a WhatsApp send (wamid.…) is longer than 50 characters; it is kept whole so delivery
-- receipts (failed / delivered / read) can be matched back to the attempt. Widening a varchar is a catalog-only
-- change in PostgreSQL (no table rewrite, brief lock).
--
-- Rollback: not needed (wider column is harmless); to undo, ALTER ... TYPE varchar(50) after truncating longer values.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE notification_attempts ALTER COLUMN provider_code TYPE varchar(160);
