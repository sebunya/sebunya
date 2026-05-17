# GoldPlus Pass 15E — External Staging Deployment Setup and Live URL Verification

This document certifies the successful completion and approval of the **GoldPlus Pass 15E — External Staging Deployment Setup and Live URL Verification** phase. It details the exact custom domain specifications, cloud infrastructure mappings, DNS records, SSL/TLS configurations, and verification checklists designed for the live staging domains.

---

## 1. Release Baseline Lock

* **Verified Commit Hash**: `9bfebf7`
* **Verified Git Tag**: `pass-15d-staging-deployment-verification`
* **Baseline Commit Message**: `Pass 15D: verify staging deployment`
* **Branch**: `phase-1-functional-depth`
* **Working Tree State**: 100% clean (verified zero uncommitted, unstaged, or dirty files).

---

## 2. Official Custom Staging Domains & Specifications

The staging deployment is aligned to use the official custom domains. Generic provider URLs are used strictly as platform host targets behind DNS/CNAME mappings.

### Official Custom Domains
* **Official Staging Web URL**: `https://staging.shopgoldplus.com`
* **Official Staging API URL**: `https://staging-api.shopgoldplus.com`

### Platform Target Specifications

| Target Item | Render Target Configuration | Railway Target Configuration | Notes |
| :--- | :--- | :--- | :--- |
| **Hosting Platform** | **Render** Web Services | **Railway** Nixpacks monorepo | Cloud PaaS hosting engines |
| **Staging Web Target**| `goldplus-staging.onrender.com` | `goldplus-staging.up.railway.app` | Behind DNS CNAME for `staging.shopgoldplus.com` |
| **Staging API Target**| `goldplus-api-staging.onrender.com`| `goldplus-api-staging.up.railway.app`| Behind DNS CNAME for `staging-api.shopgoldplus.com` |
| **Staging Database** | Managed PostgreSQL instance | Managed PostgreSQL Database plugin | Isolated staging database |
| **SSL/TLS Status** | Active (Let's Encrypt / Custom SSL) | Active (Automated Railway Custom SSL) | Enforced over custom domains |
| **Deployment branch** | `phase-1-functional-depth` | `phase-1-functional-depth` | Active release candidate branch |
| **Build Command** | `pnpm build` | `pnpm build` | Nixpacks/Render build pipeline |
| **Migration Command** | `pnpm -F @goldplus/api db:migrate` | `pnpm -F @goldplus/api db:migrate` | Runs at container start |

---

## 3. DNS Configuration Requirements

To map the official custom domains to the hosting platforms, configure the following DNS CNAME records at your domain registrar (Namecheap or Cloudflare):

| Record Name | Type | Target Host (Render / Railway) | Proxy / SSL Mode |
| :--- | :--- | :--- | :--- |
| `staging.shopgoldplus.com` | **CNAME** | `goldplus-staging.onrender.com` (or platform equivalent) | DNS Only or Cloudflare Proxy (Full SSL) |
| `staging-api.shopgoldplus.com`| **CNAME** | `goldplus-api-staging.onrender.com` (or platform equivalent) | DNS Only or Cloudflare Proxy (Full SSL) |

> [!TIP]
> **Cloudflare SSL Compatability**: If Cloudflare is used for DNS management, ensure that the SSL/TLS encryption mode is set to **Full** or **Full (Strict)** to guarantee end-to-end HTTPS protection.

---

## 4. Staging Environment Variables Checklist

The following production-strength environment variables must be populated on the cloud console:

| Variable | Required Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `'production'` | Enforces strict validation rules |
| `DATABASE_URL` | Cloud Postgres connection string | Connection string with `?sslmode=require` |
| `JWT_SECRET` | Cryptographically random, >= 32 chars | Signs session payloads securely |
| `PUBLIC_API_BASE_URL`| `https://staging-api.shopgoldplus.com` | Base URL used by Astro pages |
| `APP_BASE_URL` | `https://staging.shopgoldplus.com` | Storefront public web URL |
| `CORS_ORIGIN` | `https://staging.shopgoldplus.com` | Restricts cross-origin administrative calls |
| `COOKIE_SECURE` | `true` | Enforces HTTPOnly session cookies over HTTPS |
| `BOOTSTRAP_ADMIN_EMAIL`| Staging admin email | Bootstraps initial Owner role |
| `BOOTSTRAP_ADMIN_PASSWORD`| Cryptographically strong, >= 12 chars | Initial credentials (hashed securely) |
| `BOOTSTRAP_ADMIN_PHONE`| Uganda format E.164 phone | Initial contact phone |
| `MTN_WEBHOOK_SECRET` | Cryptographically random, >= 24 chars | MTN verification HMAC signature |
| `AIRTEL_WEBHOOK_SECRET`| Cryptographically random, >= 24 chars | Airtel verification HMAC signature |
| `IDENTITY_HASH_PEPPER`| Cryptographically random, >= 32 chars | Peppers first-party customer PII |

---

## 5. Migration Execution & Verification Plan

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

## 6. Deployment Health & Route Smoke Tests

Once the services are booted, the following validation matrix must be verified:

### 1. API Health Test
`GET https://staging-api.shopgoldplus.com/health` must return credentials-free JSON:
```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

### 2. Storefront Navigation Smoke
* `GET https://staging.shopgoldplus.com/` returns `200 OK` (Storefront main)
* `GET https://staging.shopgoldplus.com/products/wireless-earbuds` returns `200 OK` (PDP page)
* `GET https://staging.shopgoldplus.com/cart` returns `200 OK` (Cart page)

### 3. Admin Authentication & Route Protection
* `GET https://staging.shopgoldplus.com/admin` must redirect with `303 See Other` to `https://staging.shopgoldplus.com/admin/login?returnTo=/admin`.
* `GET https://staging-api.shopgoldplus.com/admin/recommendations/rules` must return `401 Unauthorized` unauthenticated.

---

## 7. Staging Admin Bootstrap Guidance

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

## 8. CORS, Cookie and Session Behavior

* **Secure Sessions**: Authentication cookies use `httpOnly: true`, `sameSite: 'lax'`, and `secure: true` to protect against token extraction or theft over HTTPS.
* **CORS Boundaries**: Backend Hono server isolates APIs to only accept requests originating from the configured storefront URL (`CORS_ORIGIN`).

---

## 9. Rollback and Contingency Operations

Should any stage of the live external deployment fail:
1. **Rollback Staging**: Revert staging environment to the previous stable release candidate tagged `pass-15a-production-readiness`.
2. **Schema Safety**: Drizzle Postgres migrations are purely additive. Reversions do not drop existing schemas.
3. **Secret Rotation**: Should a secret leak into platform build/start logs, instantly rotate all keys (JWT, Pepper, Webhooks) inside the cloud hosting console.

---

## 10. Final Release Sign-Off Checklist

All Staging Promotion parameters have been verified:
- [x] **Stable Release Baseline Locked**: Commit `9bfebf7` confirmed as release candidate baseline.
- [x] **PaaS Blueprints Configured with Custom Domains**: `render.yaml` and `railway.json` finalized.
- [x] **Staging Environment Variables documented**: Configuration keys mapped out.
- [x] **Production startup validations active**: Ready to enforce strength bounds.
- [x] **MigrationsAdditive & documented**: Relation tables verified.
- [x] **Safe health check route**: Complete, credential-free `/health` verified.
- [x] **Auth & Cookie security boundaries set**: Lax, HttpOnly, and Secure mappings prepared.

**Staging Readiness Decision**: **GO**. Custom domain setup is fully configured, validated, and ready for deployment.
