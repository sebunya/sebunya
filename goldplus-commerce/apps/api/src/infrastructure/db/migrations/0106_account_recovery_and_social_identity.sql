-- ═══════════════════════════════════════════════════════════════════════════
-- 0106 — Account recovery and social identity (2026-08-07)
--
-- Two doors that did not exist. A customer who forgot their password had no
-- way back into their account — no reset route, no token table, no page — and
-- the only way to sign up was to invent and remember another password.
--
-- 1. password_reset_tokens
--    The raw token is NEVER stored. Only its SHA-256 lands here, so a database
--    read cannot be replayed into an account takeover — the same reasoning as
--    auth_sessions storing refresh tokens hashed.
--    Single-use (consumed_at), short-lived (expires_at), and bound to one user.
--
-- 2. user_identities
--    One row per (provider, subject). `subject` is the provider's stable
--    identifier — NOT the email, which users change and which providers do not
--    all verify. The unique index on (provider, subject) is what makes a second
--    sign-in a login rather than a duplicate account.
--    email_verified is recorded because it decides whether this identity may be
--    auto-linked to an existing password account. An unverified provider email
--    linking to a local account is an account takeover, not a convenience.
--
-- 3. users.password_hash becomes NULLABLE
--    A customer who signs up with Google has no password, and inventing one
--    for them would be a credential nobody chose. NULL means "no password
--    login on this account" and password authentication must FAIL CLOSED on
--    it — never treat a null hash as an empty password that matches.
--
-- ADDITIVE AND REVERSIBLE; no INSERTs. Ships EMPTY: no provider credential is
-- configured, so every social route answers NOT_CONFIGURED until an operator
-- supplies one, and reset emails do not send until a mail credential exists.
--
-- Rollback:
--   DROP TABLE IF EXISTS password_reset_tokens;
--   DROP TABLE IF EXISTS user_identities;
--   -- only safe while every row still has a password:
--   -- ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- SHA-256 hex of the raw token. The raw value exists only in the message
  -- sent to the customer and never at rest.
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "requested_ip" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_hash_uq" ON "password_reset_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_idx" ON "password_reset_tokens" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expiry_idx" ON "password_reset_tokens" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" varchar(20) NOT NULL,
  "subject" varchar(255) NOT NULL,
  "email" varchar(255),
  "email_verified" boolean NOT NULL DEFAULT false,
  "linked_at" timestamptz NOT NULL DEFAULT now(),
  "last_login_at" timestamptz,
  CONSTRAINT "user_identities_provider_vocab" CHECK ("provider" IN ('google', 'apple', 'facebook'))
);
--> statement-breakpoint
-- The identity of an account at a provider. A second sign-in finds this row
-- and logs in; without it, every sign-in would create another account.
CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_provider_subject_uq" ON "user_identities" ("provider", "subject");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_identities_user_idx" ON "user_identities" ("user_id");
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
