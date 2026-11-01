-- Slice 3B — durable, revocable sessions with refresh rotation and reuse detection.
--
-- WHY
-- Auth was stateless JWT validated by signature only: no logout, no refresh
-- rotation, no reuse detection, no server-side revocation. A leaked or stolen
-- token stayed valid until expiry with nothing able to stop it, and "log out
-- everywhere" was impossible. The durable record of truth for a session must
-- outlive any cache, so it lives in PostgreSQL, not Redis — revocation stays
-- correct even if Redis is entirely down.
--
-- DESIGN
-- Access tokens stay short-lived and stateless (validated by signature, no
-- per-request DB hit). Refresh credentials are long-lived, SINGLE-USE and
-- ROTATED: each refresh mints a new credential in the same family_id and marks
-- the old row consumed (rotated_at). Presenting an already-consumed credential
-- is reuse — either the legitimate client or an attacker replayed it and we
-- cannot tell which, so we revoke the WHOLE family. A "session" is a family;
-- session inventory groups active families per user. The refresh credential is
-- only ever stored as a SHA-256 hash — a database read cannot recover a usable
-- token. users.sessions_invalidated_after gives immediate hard revocation
-- (password change, account disable, admin action): the auth middleware, which
-- already loads the user, rejects any token issued at or before that instant,
-- so revocation does not wait for the access-token TTL.
--
-- LOCK RISK
-- Additive: one new table and one nullable column on users (a metadata-only
-- ADD COLUMN with no default rewrite). No exclusive rewrite of an existing hot
-- table. Safe to apply online.

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The durable session. Rotation keeps this stable; a new row per rotation
  -- shares it. Revocation acts on the whole family.
  family_id uuid NOT NULL,
  -- SHA-256 hex of the current refresh credential. Never the raw token.
  refresh_hash varchar(64) NOT NULL,
  -- Id of this refresh credential, echoed in the issued token for correlation.
  jti uuid NOT NULL,
  -- Signing-key generation; lets a key rotation invalidate old credentials.
  key_version integer NOT NULL DEFAULT 1,
  -- Bumped when the user's roles/permissions change so a stale session must
  -- re-establish rather than keep acting on old authority.
  permission_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  -- Set when this credential is consumed by a rotation. A non-null value on a
  -- presented credential means reuse.
  rotated_at timestamptz,
  revoked_at timestamptz,
  revoked_reason varchar(48),
  -- Inventory only, hashed — an operator can list "3 active sessions" without
  -- storing a raw IP or user-agent the user never consented to retain.
  user_agent_hash varchar(64),
  ip_hash varchar(64),
  CONSTRAINT auth_sessions_refresh_hash_len CHECK (char_length(refresh_hash) = 64)
);

-- One credential per hash; the rotation lookup is by hash and must be unique.
CREATE UNIQUE INDEX auth_sessions_refresh_hash_uq ON auth_sessions (refresh_hash);
-- Active-session inventory and revocation sweeps per user.
CREATE INDEX auth_sessions_user_active_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;
-- Family revocation (reuse detection, logout of one session).
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);
-- Cleanup of expired credentials.
CREATE INDEX auth_sessions_refresh_expiry_idx ON auth_sessions (refresh_expires_at);

-- Immediate hard revocation cutoff. Null means "no forced invalidation".
ALTER TABLE users ADD COLUMN sessions_invalidated_after timestamptz;
