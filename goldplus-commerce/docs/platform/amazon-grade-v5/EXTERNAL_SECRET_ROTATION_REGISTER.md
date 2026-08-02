# External Secret Rotation Register

These rotations are operator actions. Claude has not performed them, cannot
verify them from the repository, and does not claim them. The release gate
reports `EXTERNAL_SECRET_ROTATIONS_VERIFIED=false` and
`FULL_RELEASE_READY=false` until an authorised operator attaches evidence.

| Credential | Where used | Required action | Evidence to attach |
|---|---|---|---|
| Pesapal consumer key/secret | payment start/verify | rotate in Pesapal portal, update production env injection | rotation timestamp + first successful verified payment after rotation |
| ZeptoMail token | transactional email | rotate token | rotation timestamp |
| SMS provider key | OTP/SMS | rotate key | rotation timestamp |
| JWT signing secret | API sessions | rotate; invalidates sessions — schedule window | rotation timestamp + forced re-login confirmation |

**Repository-side rotation support (post-PR §14):** `Hs256TokenSigner` now honours an optional `JWT_SECRET_PREVIOUS` for VERIFY only (never sign) — a safe dual-key rotation window so live sessions signed with the old secret keep verifying until they expire. Rotate: set `JWT_SECRET_PREVIOUS=<old>`, set `JWT_SECRET=<new>`, deploy; after the access-token TTL (15 min) elapses, remove `JWT_SECRET_PREVIOUS`. Proven by `tests/unit/Hs256TokenSignerRotation.test.ts` (4/4). Provider-side/operator rotation remains EXTERNAL.
| MTN / Airtel webhook secrets | payment webhooks | rotate; update provider portal + env | first verified webhook after rotation |
| Database password | PostgreSQL | rotate via managed change | rotation timestamp |
| Identity hash pepper | PII digests | rotate only with migration plan (re-hash) — do NOT rotate blindly | operator decision record |
| Bootstrap admin password | first-run admin | rotate/disable bootstrap path in production | verification that bootstrap login is disabled |

Repository-side protections already in place: no tracked env files, blocking
secret scan in the gate (1391 files), `.env.example` placeholders only,
production requires injected secrets, no env-credential fallback in the vault.
