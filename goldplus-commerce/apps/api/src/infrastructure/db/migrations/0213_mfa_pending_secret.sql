-- 0213 (2026-11-01): re-enrolling an authenticator parks the new secret here until its first code is confirmed.
-- Before, re-enrolment overwrote the confirmed secret and cleared confirmed_at at once, so an abandoned re-enrolment
-- left the account with no confirmed MFA, and the next enrol needed no code at all. Nullable, no backfill.
-- Rollback: ALTER TABLE user_mfa DROP COLUMN IF EXISTS pending_secret_ciphertext;
ALTER TABLE user_mfa ADD COLUMN IF NOT EXISTS pending_secret_ciphertext varchar(512);
