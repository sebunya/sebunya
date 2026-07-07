# Security Hardening, Two-Factor Auth & Fraud Controls

## Two-factor authentication

Three second factors, all real:

- **TOTP** (authenticator apps) — RFC 6238/4226, verified in tests against the
  published RFC vectors. Enrolment returns a secret + `otpauth://` URI (QR) and,
  on confirmation, **one-time backup codes** (shown once, stored hashed).
- **SMS OTP** — via the reworked generic SMS gateway.
- **Email OTP** — via ZeptoMail.

OTP codes are never stored in plaintext — only an HMAC-SHA256 hash (server
pepper) — and each challenge is single-use, time-boxed (5 min), and attempt-capped
(brute-force proof). Resends are rate-limited.

### Login flow with 2FA

```
POST /auth/login                     # password ok + 2FA on -> { twoFactorRequired, method, pendingToken }
# TOTP:
POST /auth/2fa/login                 # { pendingToken, code } -> session token
# SMS/email:
POST /auth/2fa/login/otp/start       # { pendingToken } -> sends code
POST /auth/2fa/login/otp/verify      # { pendingToken, challengeId, code } -> session token
```

The `pendingToken` is a short-lived **`2fa_pending`-scoped** JWT — the session
middleware rejects it, so a half-authenticated token can never reach account
resources. Backup codes are accepted in place of a TOTP code and consumed on use.

### Management (full session required)

```
GET  /auth/2fa/status
POST /auth/2fa/totp/enroll  ->  POST /auth/2fa/totp/confirm { code }
POST /auth/2fa/otp/start { channel }  ->  POST /auth/2fa/otp/confirm { challengeId, code }
POST /auth/2fa/disable { code }        # requires a valid current factor
```

## SMS module (reworked)

The hard-disabled Phase-1 stub is replaced by `GenericHttpSmsAdapter`, a real
pluggable HTTP gateway (`SMS_API_URL` / `SMS_API_KEY` / `SMS_SENDER_ID`). Missing
config → `NOT_CONFIGURED` (no fake sends). It's the transport behind SMS OTP and
integrates with the existing notification-attempt logging.

## Brute-force & rate limiting

- **Per-IP rate limits** (fixed window) on `/auth/*`, `/webhooks/*`, `/events/*`,
  returning `429` + `Retry-After`. Pure decision logic is unit-tested; the store
  is in-memory (swap for Redis when scaling).
- **Account lockout**: failed logins are logged to `auth_attempts`; after 8
  failures in 15 minutes authentication is refused (`429 ACCOUNT_LOCKED`),
  independent of the soft risk score.
- Login stays **generic on failure** (never reveals whether an email exists),
  passwords are scrypt-hashed, and all token/signature checks are constant-time.

## Risk & fraud scoring

A pure `RiskEngine` turns real signals into a 0–100 score + `allow/challenge/deny`:

- **Login risk**: failed-login velocity (per email and per IP), new device
  (no prior success), and OTP failures.
- **Order risk**: order velocity by delivery phone — blatant automation
  (≥10 orders/hour) is denied at checkout (`429 ORDER_RISK_BLOCKED`) while genuine
  customers pass untouched. Elevated-but-not-blatant velocity is flagged, not blocked.

Every login attempt (and its risk score) is recorded for audit and future
tuning. High-risk security events are written to the audit log.

## Response security headers

Applied to every API response: `Content-Security-Policy` (script-free — the API
is JSON-only), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`,
and HSTS in production.

## Configuration

See `.env.example`: `SMS_API_URL/KEY/SENDER_ID`, `OTP_PEPPER`. With none set,
SMS/OTP report `NOT_CONFIGURED` and TOTP still works fully offline.

## Testing

- `tests/unit/TwoFactor.test.ts` — TOTP vs RFC vectors, base32, OTP state machine,
  masking, backup codes.
- `tests/unit/SecurityControls.test.ts` — rate-limit windows/reset/keying, login
  throttle threshold, login & order risk scoring.

## Known follow-ups (roadmap)

TOTP-secret encryption at rest, Redis-backed distributed rate limiting, device
fingerprinting for the "known device" signal, and WebAuthn/passkeys.
