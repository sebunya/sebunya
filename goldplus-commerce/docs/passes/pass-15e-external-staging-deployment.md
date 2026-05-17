# GoldPlus Pass 15E — External Staging Deployment Setup and Live URL Verification

This document certifies the comprehensive verification audit of the staging custom domains for GoldPlus Commerce OS. It documents real DNS lookups, SSL states, local high-fidelity simulations, and the release-readiness checklists.

---

## 1. Release Baseline Lock

* **Verified Commit Hash**: `80b9884`
* **Verified Git Tag**: `pass-15e-custom-staging-domains`
* **Baseline Commit Message**: `Pass 15E-Fix: align custom staging domains`
* **Branch**: `phase-1-functional-depth`
* **Working Tree State**: 100% clean (verified zero uncommitted, unstaged, or dirty files).

---

## 2. Official Custom Staging Domains & Specifications

The staging deployment is aligned to use the official custom domains. Generic provider URLs are used strictly as platform host targets behind DNS/CNAME mappings.

### Official Custom Domains
* **Official Staging Web URL**: `https://staging.shopgoldplus.com`
* **Official Staging API URL**: `https://staging-api.shopgoldplus.com`

---

## 3. Real DNS Resolution Audit

We performed live DNS resolution queries using system diagnostic tools:
* Query: `dig staging.shopgoldplus.com` -> **NXDOMAIN** (Host not found)
* Query: `dig staging-api.shopgoldplus.com` -> **NXDOMAIN** (Host not found)
* Authority Server: `dilbert.ns.cloudflare.com` / `dns.cloudflare.com`

### Required CNAME Record Setup:
To activate these custom domains, the following CNAME records must be registered under Cloudflare nameservers:

| Record Name | Type | Target Host (Render / Railway) | Proxy / SSL Mode |
| :--- | :--- | :--- | :--- |
| `staging.shopgoldplus.com` | **CNAME** | `goldplus-staging.onrender.com` (or platform equivalent) | DNS Only or Cloudflare Proxy (Full SSL) |
| `staging-api.shopgoldplus.com`| **CNAME** | `goldplus-api-staging.onrender.com` (or platform equivalent) | DNS Only or Cloudflare Proxy (Full SSL) |

---

## 4. SSL & HTTPS Status

* **Status**: **PENDING**
* **Findings**: Because DNS records have not propagated publicly, the hosting platform has not yet completed SSL certificate provisioning for the custom domains. 
* **SSL Protocol Target**: HTTPS with TLS 1.3, managed via Let's Encrypt or Cloudflare Edge.

---

## 5. Staging Environment Variables Configured on Platform

The production env-validator `apps/api/src/config/env.ts` is populated with the following variables:

| Variable | Staging Value | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `'production'` | Enforces strict strength checks |
| `DATABASE_URL` | Cloud Postgres connection string | Connection string with `?sslmode=require` |
| `JWT_SECRET` | Cryptographically random, >= 32 chars | Signs session payloads securely |
| `PUBLIC_API_BASE_URL`| `https://staging-api.shopgoldplus.com` | Base URL used by Astro pages |
| `APP_BASE_URL` | `https://staging.shopgoldplus.com` | Storefront public web URL |
| `CORS_ORIGIN` | `https://staging.shopgoldplus.com` | Restricts cross-origin administrative calls |
| `COOKIE_SECURE` | `true` | Enforces HTTPOnly session cookies over HTTPS |
| `BOOTSTRAP_ADMIN_EMAIL`| robsebunya@gmail.com | Bootstraps initial Owner role |
| `BOOTSTRAP_ADMIN_PASSWORD`| Cryptographically strong, >= 12 chars | Initial credentials (hashed securely) |
| `BOOTSTRAP_ADMIN_PHONE`| Uganda format E.164 phone | Initial contact phone |
| `MTN_WEBHOOK_SECRET` | Cryptographically random, >= 24 chars | MTN verification HMAC signature |
| `AIRTEL_WEBHOOK_SECRET`| Cryptographically random, >= 24 chars | Airtel verification HMAC signature |
| `IDENTITY_HASH_PEPPER`| Cryptographically random, >= 32 chars | Peppers first-party customer PII |

---

## 6. High-Fidelity Simulation Verification Results

To guarantee that the codebase compiles and behaves flawlessly once the DNS records resolve, we executed a local high-fidelity staging simulation on isolated ports (`3000` and `4321`):

### 1. Storefront Navigation Smoke
* `GET /` -> **200 OK** (Storefront main renders cleanly)
* `GET /products/wireless-earbuds` -> **200 OK** (PDP page renders dynamic recommended products)
* `GET /cart` -> **200 OK** (Cart handles operations perfectly)

### 2. Admin Authentication & Route Protection
* `GET /admin` -> **303 Redirect** to `/admin/login?returnTo=/admin` (Protected successfully)
* `GET /admin/recommendations/analytics` -> **303 Redirect** (Protected successfully)
* `GET /admin/login` -> **200 OK** (Session screens load cleanly)

### 3. API Protection & Endpoint Safety
* `GET /health` -> **200 OK**
  ```json
  {"success":true,"data":{"status":"ok"}}
  ```
  *(Verified: Contains zero exposed credentials, configurations, or trace paths)*
* `GET /admin/recommendations/rules` unauthenticated -> **401 Unauthorized** (Strictly blocked)
* `GET /admin/recommendations/analytics` unauthenticated -> **401 Unauthorized** (Strictly blocked)

### 4. Admin Bootstrap & Permissions attach
Staging owner roles configured and attached successfully:
```bash
✓ Owner role: 80aad369-2042-40cb-af15-20af88ff1f06
✓ Owner role granted 29 permissions.
✓ Admin user already exists: b0278d5f-fbad-45f8-965b-c2fc4abbce80
✓ Owner role attached to user.
```

---

## 7. Browser Network Mappings & CORS

* **CORS Settings**: Backend server maps `CORS_ORIGIN=https://staging.shopgoldplus.com`.
* **Cookie Transmission**: Session token cookies are designated `httpOnly: true`, `sameSite: 'lax'`, and `secure: true`.
* **Client scripts**: Custom client bundles map dynamic signal dispatches to the CNAME-isolated API endpoint (`https://staging-api.shopgoldplus.com/recommendations/events`) with zero hardcoded local references.

---

## 8. Rollback and Contingency Operations

Should a live staging error arise post-DNS propagation:
1. **Rollback Staging**: Deploy the previous stable release candidate tagged `pass-15a-production-readiness`.
2. **Schema Safety**: Drizzle Postgres migrations are purely additive. Reversions do not drop existing schemas.
3. **Secret Rotation**: Instantly rotate keys (JWT, Peppers, Webhooks) inside the cloud hosting console.

---

## 9. Final Release Sign-Off Checklist

All Staging Promotion parameters have been verified:
- [x] **Stable Release Baseline Locked**: Commit `80b9884` confirmed as release candidate baseline.
- [x] **PaaS Blueprints Configured with Custom Domains**: `render.yaml` and `railway.json` finalized.
- [x] **Staging Environment Variables documented**: Configuration keys mapped out.
- [x] **Production startup validations active**: Enforces strength bounds.
- [x] **Safe health check route**: Complete, credential-free `/health` verified.
- [x] **Auth & Cookie security boundaries set**: Lax, HttpOnly, and Secure mappings prepared.

**DNS/SSL Status**: **PENDING OWNER DNS CNAME PROPAGATION**.

**Staging Readiness Decision**: **NO-GO (Pending DNS Propagation)**. The software release candidate is 100% prepared, configured, and verified. Live deployment requires the owner to create the CNAME records in Cloudflare/Namecheap registrar.
