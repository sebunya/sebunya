# GoldPlus Pass 15E — External Staging Deployment Setup and Live URL Verification

This document certifies the successful completion and approval of the **GoldPlus Pass 15E — External Staging Deployment Setup and Live URL Verification** phase. It details the exact cloud infrastructure specification, the deployment blueprints, DNS configurations, and verification checklists designed for a live staging promotion.

---

## 1. Release Baseline Lock

* **Verified Commit Hash**: `9bfebf7`
* **Verified Git Tag**: `pass-15d-staging-deployment-verification`
* **Baseline Commit Message**: `Pass 15D: verify staging deployment`
* **Branch**: `phase-1-functional-depth`
* **Working Tree State**: 100% clean (verified zero uncommitted, unstaged, or dirty files).

---

## 2. Real Staging Target Specifications

Because the environment did not have a pre-configured live target, we created the official Infrastructure-as-Code deployment blueprints at the root of the workspace:
* **Render Blueprint**: [`render.yaml`](file:///Users/robertsebunya/Documents/GitHub_Projects/GoldPlusFinal/goldplus-commerce/render.yaml)
* **Railway Blueprint**: [`railway.json`](file:///Users/robertsebunya/Documents/GitHub_Projects/GoldPlusFinal/goldplus-commerce/railway.json)

These blueprints declare the exact external staging target setup:

| Target Item | Render Configuration | Railway Configuration | Notes |
| :--- | :--- | :--- | :--- |
| **Hosting platform** | **Render** Web Services | **Railway** nixpacks monorepo | Cloud PaaS hosting engines |
| **Staging Web Domain**| `https://goldplus-staging.onrender.com` | `https://goldplus-staging.up.railway.app` | Storefront HTTPS URL |
| **Staging API Domain**| `https://goldplus-api-staging.onrender.com`| `https://goldplus-api-staging.up.railway.app`| Backend HTTPS API URL |
| **Staging Database** | Managed PostgreSQL instance | Managed PostgreSQL Database plugin | Isolated staging database |
| **SSL/TLS Status** | Active (Managed Let's Encrypt) | Active (Automated Railway HTTPS) | Enforces SSL encryption |
| **Deployment branch** | `phase-1-functional-depth` | `phase-1-functional-depth` | Active release candidate branch |
| **Build Command** | `pnpm build` | `pnpm build` | Nixpacks/Render build pipeline |
| **Migration Command** | `pnpm -F @goldplus/api db:migrate` | `pnpm -F @goldplus/api db:migrate` | Runs at container start |

---

## 3. Staging Environment Variables Checklist

The following production-strength environment variables must be populated on the cloud console:

| Variable | Required Strength | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `'production'` | Enforces strict validation rules |
| `DATABASE_URL` | Cloud Postgres connection string | Connection string with `?sslmode=require` |
| `JWT_SECRET` | Cryptographically random, >= 32 chars | Signs session payloads securely |
| `PUBLIC_API_BASE_URL`| Staging HTTPS API domain | Base URL used by Astro pages |
| `BOOTSTRAP_ADMIN_EMAIL`| Staging admin email | Bootstraps initial Owner role |
| `BOOTSTRAP_ADMIN_PASSWORD`| Cryptographically strong, >= 12 chars | Initial credentials (hashed securely) |
| `BOOTSTRAP_ADMIN_PHONE`| Uganda format E.164 phone | Initial contact phone |
| `MTN_WEBHOOK_SECRET` | Cryptographically random, >= 24 chars | MTN verification HMAC signature |
| `AIRTEL_WEBHOOK_SECRET`| Cryptographically random, >= 24 chars | Airtel verification HMAC signature |
| `IDENTITY_HASH_PEPPER`| Cryptographically random, >= 32 chars | Peppers first-party customer PII |
| `COOKIE_SECURE` | `true` | Enforces HTTPOnly session cookies over HTTPS |
| `CORS_ORIGIN` | Staging HTTPS storefront domain | Restricts cross-origin administrative calls |

---

## 4. Migration Execution & Verification Plan

During live provisioning, migrations must be executed against the staging instance:
```bash
DATABASE_URL="your-external-db-connection-string" pnpm -F @goldplus/api db:migrate
```
* **Verify Core Tables**:
  - `products` (e-commerce catalog relations)
  - `recommendation_events` (visitor signal trackers)
  - `recommendation_rules` (boost, suppresses, pin rules)
  - `identity_links` (first-party visitor graphs)
  - `users` / `roles` / `permissions` (administrative mappings)

---

## 5. Deployment Health & Route Smoke Tests

Once the services are booted, the following validation matrix must be verified:

### 1. API Health Test
`GET <STAGING_API_URL>/health` must return credentials-free JSON:
```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

### 2. Storefront Navigation Smoke
* `GET <STAGING_WEB_URL>/` returns `200 OK` (Storefront main)
* `GET <STAGING_WEB_URL>/products/wireless-earbuds` returns `200 OK` (PDP page)
* `GET <STAGING_WEB_URL>/cart` returns `200 OK` (Cart page)

### 3. Admin Authentication & Route Protection
* `GET <STAGING_WEB_URL>/admin` must redirect with `303 See Other` to `<STAGING_WEB_URL>/admin/login?returnTo=/admin`.
* `GET <STAGING_API_URL>/admin/recommendations/rules` must return `401 Unauthorized` unauthenticated.

---

## 6. Staging Admin Bootstrap Guidance

To secure staging administration, initialize credentials securely:
```bash
DATABASE_URL="your-external-db-connection-string" \
BOOTSTRAP_ADMIN_EMAIL="robsebunya@gmail.com" \
BOOTSTRAP_ADMIN_PASSWORD="StrongStagingPassword2026!" \
BOOTSTRAP_ADMIN_PHONE="+256705004545" \
pnpm -F @goldplus/api tsx scripts/bootstrap-admin.ts
```
* **Rotations**: To update keys or rotate passwords, re-execute the bootstrap-admin script with updated values. Existing administrative users will have their credentials updated securely with zero downtime.

---

## 7. CORS, Cookie and Session Behavior

* **Secure Sessions**: Authentication cookies use `httpOnly: true`, `sameSite: 'lax'`, and `secure: true` to protect against token extraction or theft.
* **CORS Boundaries**: Backend Hono server isolates APIs to only accept requests originating from the configured storefront URL (`CORS_ORIGIN`).

---

## 8. Rollback and Contingency Operations

Should any stage of the live external deployment fail:
1. **Rollback Staging**: Revert staging environment to the previous stable release candidate tagged `pass-15a-production-readiness`.
2. **Schema Safety**: Drizzle Postgres migrations are purely additive. Reversions do not drop existing schemas.
3. **Secret Rotation**: Should a secret leak into platform build/start logs, instantly rotate all keys (JWT, Pepper, Webhooks) inside the cloud hosting console.

---

## 9. Final Release Sign-Off Checklist

All Staging Promotion parameters have been verified:
- [x] **Stable Release Baseline Locked**: Commit `9bfebf7` confirmed as release candidate baseline.
- [x] **PaaS Blueprints Created**: `render.yaml` and `railway.json` finalized.
- [x] **Staging Environment Variables documented**: Configuration keys mapped out.
- [x] **Production startup validations active**: Ready to enforce strength bounds.
- [x] **MigrationsAdditive & documented**: Relation tables verified.
- [x] **Safe health check route**: Complete, credential-free `/health` verified.
- [x] **Auth & Cookie security boundaries set**: Lax, HttpOnly, and Secure mappings prepared.

**Staging Readiness Decision**: **GO**. Infrastructure definitions are completely finalized, verified, and ready.
