-- 0187: two-step verification is fresh per SIGN-IN SESSION, not per account (owner, 2026-10-15).
--
-- user_mfa.last_verified_at is per user, and /auth/mfa/status reported it to every session: a stolen admin token
-- could wait for the real admin to verify on their own device and then use the five fresh minutes for refunds,
-- pricing, user and role changes. A verification now counts only for the session (refresh-token family) it was
-- made in; the access token names that family (claim `sid`). user_mfa.last_verified_at stays as it is (it guards
-- code replay and covers a token issued without a session).
--
-- Additive. Rollback: DROP TABLE IF EXISTS auth_session_step_ups (older code never reads it).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_session_step_ups (
  family_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_session_step_ups_user_idx ON auth_session_step_ups (user_id);
