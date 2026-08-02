# V5 Stop-Ship Register

Every §7 finding re-verified against the current branch
(`claude/amazon-grade-goldplus-commerce-os-v5-production-20260802`, base
`e99a96a`). Per §0A.10: a finding is closed only with current-source evidence,
and a stale finding is recorded as already corrected rather than re-implemented.

| # | Finding | Status | Current-source evidence |
|---|---|---|---|
| 7.1 | Secrets in archives/tree | **CLOSED (verified)** | No `.env`/`.env.production` tracked in the tree; `pnpm security:scan-secrets` passes (1391 files, exit 0, values never printed); `.env.example` placeholders only |
| 7.1 | External credential rotation | **EXTERNAL — OPEN** | Cannot be closed from the repository; see EXTERNAL_SECRET_ROTATION_REGISTER.md. FULL_RELEASE_READY stays false until operator evidence exists |
| 7.2 | Forged payment webhooks | **CLOSED (verified, residuals recorded)** | `routes/webhooks.ts`: HMAC over raw body with `timingSafeEqual`; 401 on invalid signature when secret configured, 503 NOT_CONFIGURED when absent; amount compared against authoritative order total; replay detected via idempotency; purchase telemetry emitted only on first verified non-review SUCCESS; signature rejections logged without payload. *Residuals:* no timestamp/nonce binding inside the signature (whole-payload replay is handled by idempotency instead); unverified-webhook grace mode routes to a loud finance review queue by explicit flag |
| 7.3 | Client-supplied checkout price | **CLOSED (verified)** | `routes/commerce.ts` (Slice 3B): input schema takes productId/quantity/delivery intent only, comment "Client prices/sku/names are [ignored]"; pricing quote provenance columns (migration 0042) snapshot the server quote; checkout e2e proofs (43 checks) exercised this path |
| 7.4 | Cart/order ownership | **CLOSED (verified)** | Migration 0060 `owner_kind`/`owner_id`/`version`; `MutateCartUseCase` authorize() with NOT_OWNED reported as CART_NOT_FOUND; signed guest cart credential (`x-goldplus-cart`); cart-authorization proof (25 checks) in `scripts/qa/cart-authorization-proof.ts` |
| 7.5 | Unauthenticated admin mounts | **CLOSED (verified)** | `tests/architecture/admin-route-authentication.test.ts` + Slice 8-B1 deny-by-default sweep: 84-page disk-derived inventory, 83 protected, allowlist = login only; API admin mounts behind `authMiddleware` + `requirePermissions` |
| 7.6 | Credential-vault env fallback | **CLOSED (verified)** | `grep ALLOW_ENV_CREDENTIAL_FALLBACK` → 0 occurrences in apps/api/src |
| 7.7 | Consent bypass / duplicate router | **CLOSED (verified)** | `consent_satisfied` hardcode → 0 occurrences; canonical consent routing via consent-operating layer |
| 7.8 | Admin token in localStorage | **CLOSED (this slice)** | Session was already an HttpOnly SameSite=Lax cookie (Secure in prod) — the localStorage claim was stale for page auth. HOWEVER four measurement pages made client-side API calls with a phantom `localStorage.gp_auth_token` no code ever set, so DLQ replay, overview/match-quality refresh, attribution lookup and consent audit always failed with 401. Fixed: same-origin allowlisted proxy `apps/web/src/pages/api/admin/measurement/[...path].ts` attaches the bearer token server-side from the session cookie; all `gp_auth_token` references removed. *Residuals:* 7-day session lifetime without server-side revocation inventory; MFA exists (TOTP + OTP module) but enforcement per privileged role not re-verified this slice |
| 7.9 | Outbox claim/fencing | **CLOSED (verified)** | 0059 durable side effects + fenced lease (`claim_token`/`fencing_number`, 0058); `requireFence.ts`; `OutboxClaimFilter` prevents cross-consumer claim; checkout durability proof 38/38 |
| 7.10 | Transaction retry | **CLOSED (verified)** | Retry at the transaction boundary in `db/client.ts` and `DrizzleInventoryRepository` (serialization-failure aware) |
| 7.11 | Auth abuse/enumeration | **CLOSED (verified)** | `RedisAbuseControlStore` + `RedisLoginAttemptStore` (real-Redis integration test proves shared limits across two replicas); login throttle domain logic; in-memory store retained only as explicit non-production fallback |
| 7.12 | Money types/constraints | **PARTIAL — recorded** | Monetary columns are `integer` UGX (no sub-units; aggregates cast `::bigint` in SQL). int4 ceiling (~2.1e9 UGX per order) is a real but non-imminent bound. Widening to bigint is an additive migration queued for Slice 2 of this programme; constraints for positive quantity/unique cart line exist (0060), CHECK coverage for non-negative money not yet complete |
| 7.13 | Distributed rate limiting | **CLOSED for auth paths / PARTIAL globally** | Redis-backed limiter proven across replicas for login/abuse; not yet applied to every public endpoint family; trusted-proxy IP resolution not re-verified this slice |
| 7.14 | Stock reservation | **CLOSED (verified)** | `reserved_quantity` + reservation ledger (inventory vertical, migration 0053 reservation_state on orders); available-to-promise clamps at zero; `products_reserved_within_stock` constraint exists NOT VALID pending production H-01 reconciliation (external data blocker, recorded) |

## Open engineering items promoted to the execution queue

1. Slice 2: bigint money migration + non-negative CHECKs (additive, parity-verified).
2. Slice 3: session revocation inventory + shortened admin session + MFA enforcement audit.
3. Slice 3: extend the distributed limiter to public endpoint families with trusted-proxy IP resolution.
4. Slice 7: scheduled alert evaluation runner (V2 leftover), self-service explorer, Playwright.
