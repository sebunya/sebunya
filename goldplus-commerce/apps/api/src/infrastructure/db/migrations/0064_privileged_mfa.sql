-- Slice 3C — privileged MFA and step-up authentication.
--
-- WHY
-- Nothing enforced multi-factor auth on privileged actions (user/role admin,
-- pricing approval, catalogue publication, credential management, controlled
-- activation, canary control, sensitive export, release approval). A single
-- stolen or phished admin password was total compromise. TOTP is the reused,
-- offline-verifiable second factor; recovery codes are the break-glass.
--
-- DESIGN
-- The TOTP secret is stored ENCRYPTED (AES-256-GCM) — a database read or a
-- leaked backup must not yield a working second factor. Recovery codes are
-- stored only as SHA-256 hashes and are strictly single-use (used_at). Step-up
-- freshness lives in last_verified_at: a privileged action requires a recent
-- MFA verification, not merely that MFA exists, so a long-lived session cannot
-- perform a sensitive action hours after the factor was last proven.
--
-- LOCK RISK: additive (two new tables). Safe online.

CREATE TABLE user_mfa (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- AES-256-GCM of the base32 TOTP secret, base64(iv|tag|ciphertext). Never plain.
  secret_ciphertext text NOT NULL,
  -- Null until the user proves the first code; an unconfirmed enrolment cannot
  -- satisfy a step-up.
  confirmed_at timestamptz,
  -- Drives step-up freshness.
  last_verified_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 hex of the recovery code. Single-use via used_at.
  code_hash varchar(64) NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_mfa_recovery_code_hash_len CHECK (char_length(code_hash) = 64)
);

CREATE UNIQUE INDEX user_mfa_recovery_code_hash_uq ON user_mfa_recovery_codes (code_hash);
CREATE INDEX user_mfa_recovery_codes_user_idx ON user_mfa_recovery_codes (user_id) WHERE used_at IS NULL;
