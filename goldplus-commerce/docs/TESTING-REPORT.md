# Testing Report — Debug & Feature Pass (2026-07-06)

## Baseline (before changes)

| Check                        | Result |
|------------------------------|--------|
| `pnpm typecheck` (3 packages)| ✅ pass |
| `pnpm test` (vitest)         | ✅ 100/100 tests, 19 files |
| `pnpm build` (api + web)     | ✅ pass |

Core flows covered by the existing suite and re-verified: product catalogue &
filtering, cart, checkout, order tracking, payment webhook idempotency, quotes,
dealer applications, support, verification, governance/audit, admin auth,
outbox processing, product images/attributes.

## Bugs found & fixed

1. **`requestId` never set on routed requests** —
   `apps/api/src/interfaces/http/app.ts` registered the request-id middleware
   *after* all routes, so Hono never ran it for routed paths and error
   envelopes (`meta.requestId`) carried `undefined`. Middleware moved above
   route registration. This restores request correlation in error logs.

2. **ZeptoMail adapter was a stub** — it returned
   `PROVIDER_NOT_WIRED` even with valid credentials. Replaced with a real
   HTTP transport (see `docs/transactional-email.md`); the "not configured"
   truth-telling behaviour is preserved and now unit-tested.

## After changes

| Check                        | Result |
|------------------------------|--------|
| `pnpm typecheck`             | ✅ pass |
| `pnpm test`                  | ✅ 138/138 tests, 23 files |
| `pnpm build`                 | ✅ pass |
| Architecture tests           | ✅ pass (domain purity, layer boundaries, admin auth/audit rules) |
| Drizzle migration generated  | ✅ `0005_stale_firelord.sql` via `pnpm db:generate` |

## New test files (38 new tests)

- `tests/unit/ActivityEvent.test.ts` — event vocabulary, validation limits,
  property sanitisation, recording, engagement summary window clamping.
- `tests/unit/Experimentation.test.ts` — experiment validation, deterministic
  assignment, weight distribution, lifecycle transitions, duplicate keys,
  exposure event recording, non-running refusal.
- `tests/unit/Loyalty.test.ts` — earn rate & flooring, tier thresholds, ledger
  summarisation, award idempotency under webhook replay, guest orders,
  sub-threshold orders, customer summary.
- `tests/unit/ZeptoMailAdapter.test.ts` — NOT_CONFIGURED short-circuit, real
  request shape (endpoint/auth/body), success & failure mapping, network error
  handling, recipient validation, template rendering + HTML escaping.

## Not covered (requires a live environment)

- End-to-end database round-trips for the new tables (repositories follow the same
  Drizzle patterns as the existing ones; migrations apply cleanly by construction
  from `drizzle-kit generate`).
- A real ZeptoMail send or a real Google OAuth exchange (need live credentials);
  both HTTP contracts are tested against their documented API shapes with injected fetch.

---

# Pass 2 — Admin, CMS, User Management, Social Login (2026-07-06)

## After changes

| Check                        | Result |
|------------------------------|--------|
| `pnpm typecheck`             | ✅ pass |
| `pnpm test`                  | ✅ 170/170 tests, 28 files |
| `pnpm build` (api + web)     | ✅ pass |
| Architecture tests           | ✅ pass (domain purity, layer boundaries, admin auth + audit rules) |
| Drizzle migration generated  | ✅ `0006_romantic_randall_flagg.sql` (cms_pages, cms_page_revisions, user_identities) |

## What shipped

- **CMS** (`docs/cms.md`): versioned pages, scheduled publish/expire, SEO fields,
  audited admin API, public `/content/*` API + `/p/<slug>` web page + sitemap.
- **User management** (`docs/user-management.md`): `POST /auth/register` with
  password policy + welcome email, `POST /account/password`, admin
  activate/deactivate + role assign/remove with self-lockout guards.
- **Google social login** (`docs/social-login.md`): OAuth 2.0 code flow with
  state-cookie CSRF, link/sign-in/register resolution, verified-email guard,
  account identity list/unlink.
- **Admin dashboard** (`docs/admin-dashboard.md`): `GET /admin/dashboard`
  aggregating commerce, engagement, and system-health metrics.

## New test files (32 new tests; 138 → 170)

- `tests/unit/CmsPage.test.ts` — content validation, status lifecycle, visibility
  windows, versioning, revert-as-new-version, publish-window guards.
- `tests/unit/Markdown.test.ts` — safe-subset rendering, HTML-injection and
  `javascript:` URL protection.
- `tests/unit/UserManagement.test.ts` — password policy, registration (welcome
  enqueue, duplicate/weak rejection, unconfigured signer), password change, admin
  self-lockout / self-role-change / role-validation guards.
- `tests/unit/SocialLogin.test.ts` — all three account-resolution paths,
  unverified-email and disabled-account refusals, NOT_CONFIGURED propagation, and
  the GoogleOAuthAdapter (unconfigured, success, provider-rejection) via injected fetch.
- `tests/unit/AdminDashboard.test.ts` — aggregation shape and window clamping.

## Bugs / issues found this pass

- None in existing code. Google/CMS param handling surfaced a strict-mode typing
  gap (`c.req.param` is `string | undefined`); routes coerce explicitly.

## Deployment notes

- Run the new migration (`pnpm db:migrate`) before deploying.
- Assign the new permissions (`content.manage`, `dashboard.read`) to admin roles.
- Set `GOOGLE_OAUTH_*` to enable social login; otherwise those endpoints return
  `503 NOT_CONFIGURED` by design. `GOOGLE_OAUTH_REDIRECT_URI` must point at the
  **web** callback (`/auth/google/callback`).

---

# Pass 2.1 — Bug fixes & UI wiring (2026-07-07)

Surfaced the pass-1/pass-2 features that had no user-facing UI, and fixed two
real bugs found while wiring them.

## Bugs fixed

1. **Broken Google OAuth browser flow.** The original callback returned raw JSON
   to the browser and set its CSRF state cookie on the API origin, which the
   separate web origin cannot read — the flow could never complete end-to-end.
   Reworked so the **web app** owns the redirect + CSRF state (cookie on its own
   origin) and the API exposes only `GET /auth/google/url` and
   `POST /auth/google/exchange`; the access token never reaches the browser.
2. **Social-login lockout risk.** The `/account/identities/:provider` unlink
   guard checked `passwordHash.length > 0`, which is always true (social accounts
   get a random placeholder hash), so it never fired — a Google-only user could
   remove their sole login and be locked out. Now conservatively refuses to remove
   the last connected identity.

## UI wired (features that previously had no front-end)

- **Registration page** (`/register`) — the login page previously said signup was
  unavailable despite `POST /auth/register` existing. Now links to it.
- **"Continue with Google"** button on both login and register, with friendly
  `?social=<reason>` error handling on the login page.
- **Loyalty** card on the account page (balance, tier, recent points) — the API
  and earning shipped in pass 1 but were never displayed.
- **Change-password** form and **connected-accounts** (list + disconnect) on the
  account page.

## Verification

| Check          | Result |
|----------------|--------|
| `pnpm typecheck` | ✅ pass |
| `pnpm test`      | ✅ 170/170 |
| `pnpm build`     | ✅ pass (new `/register`, `/auth/google`, `/auth/google/callback`, `/p/[slug]` routes build) |

---

# Pass 3 — Recommendations, 2FA, security & fraud (2026-07-07)

## Verification

| Check          | Result |
|----------------|--------|
| `pnpm typecheck` | ✅ pass |
| `pnpm test`      | ✅ 212/212 tests, 32 files |
| `pnpm build`     | ✅ pass |
| Architecture tests | ✅ pass (domain purity, boundaries, admin auth/audit) |
| Migration        | ✅ `0007_sour_mysterio.sql` (user_two_factor, otp_challenges, auth_attempts) |

## What shipped

- **Recommendation & personalisation engine** (`docs/recommendations.md`):
  normalised item-to-item collaborative filtering, personalised "for you",
  trending; public routes resolving to public product DTOs.
- **Two-factor auth** (`docs/security-2fa-fraud.md`): TOTP (RFC-verified),
  SMS + email OTP, backup codes, login step-up via a `2fa_pending`-scoped token.
- **SMS module rework**: real pluggable HTTP gateway (NOT_CONFIGURED when unset).
- **Security hardening**: per-IP rate limits, security headers, account lockout.
- **Fraud/risk controls**: login + order risk scoring; checkout velocity guard.

## New test files (37 new tests; 175 → 212)

- `tests/unit/Recommendation.test.ts` — scoring normalisation, personalisation
  weighting, diversity, exclusions, cold-start.
- `tests/unit/TwoFactor.test.ts` — TOTP vs RFC 4226 vectors, base32, OTP state
  machine, masking, backup codes.
- `tests/unit/SecurityControls.test.ts` — rate limiting, login throttle, login &
  order risk scoring.

## Deployment notes

- Run migration `0007` before deploying.
- Optional env: `SMS_API_URL/KEY/SENDER_ID` (SMS OTP), `OTP_PEPPER`. Without
  them, SMS/OTP report NOT_CONFIGURED and TOTP still works fully.
- Recommendations improve as first-party events accumulate; they cold-start from
  trending, so they're safe to ship on day one.
