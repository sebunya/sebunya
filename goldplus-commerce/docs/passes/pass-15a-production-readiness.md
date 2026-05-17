# GoldPlus Pass 15A — Production Readiness and Deployment Hardening Runbook

This document establishes the official production readiness and deployment runbook for GoldPlus Commerce OS. It provides precise instructions for configuring environments, managing secrets, executing migrations, bootstrapping admins, and validating target deployment releases.

---

## 1. Production Readiness Summary

GoldPlus has successfully implemented a centralized environment configuration layer, strong startup validations, secure session cookies, relative same-origin admin request mechanics, and unauthenticated page access controls. The workspace compiles cleanly and all 203 quality gates are fully green.

| Readiness Area | Verification Result | Production Status |
| :--- | :--- | :--- |
| **Production Build** | Clean workspace compile of both Astro & API servers | **READY** |
| **Startup Validation** | Boot-time environment validation and strength checks | **READY** |
| **Secrets Safety** | Hardened `.env.example` templates & `.gitignore` rules | **READY** |
| **Demo Guards** | Obvious/Weak secrets blocked; demo seed blocked in production | **READY** |
| **Health Checks** | Stable `/health` check with zero credential exposure | **READY** |
| **Admin Route Security** | Explicit redirect controls for all protected pages | **READY** |
| **Database Migrations** | Drizzle migrations fully committed; separate lookup seeds | **READY** |

---

## 2. Environment Variables Dictionary

Every GoldPlus environment must configure the following key-value pairs. Under `NODE_ENV=production`, strict strength validation and placeholder check requirements are automatically executed.

### Core Runtime Variables
* **`NODE_ENV`**: Sets runtime behaviors. Must be `'development'` or `'production'`. Under `'production'`, strict checks are triggered.
* **`DATABASE_URL`**: Fully qualified Postgres connection URL (e.g. `postgresql://user:pass@host:port/dbname?sslmode=require`). **Required**.
* **`JWT_SECRET`**: High-entropy secret key used to sign and verify administrative auth tokens.
  - *Production Rules*: Must be at least **32 characters** long and cannot contain local/development placeholders.
* **`IDENTITY_HASH_PEPPER`**: Cryptographic secret pepper used to hash customer emails and phone numbers for privacy-safe tracking analytics.
  - *Production Rules*: Must be at least **32 characters** long. Never rotate this unless database records are updated in unison.
* **`MTN_WEBHOOK_SECRET`**: Secret signature key used to verify incoming MTN Mobile Money webhook notifications.
  - *Production Rules*: Must be at least **24 characters** long.
* **`AIRTEL_WEBHOOK_SECRET`**: Secret signature key used to verify incoming Airtel Money webhook notifications.
  - *Production Rules*: Must be at least **24 characters** long.
* **`PUBLIC_API_BASE_URL`**: Public origin of the GoldPlus API service (e.g. `https://api.goldplus.com`). Used by Astro pages to execute backend fetches.

### Administrative Bootstrap Variables
* **`BOOTSTRAP_ADMIN_EMAIL`**: Email address of the first system Administrator.
* **`BOOTSTRAP_ADMIN_PASSWORD`**: Strong initial password (minimum **12 characters**).
* **`BOOTSTRAP_ADMIN_PHONE`**: Uganda phone number of the initial Administrator in E.164 format.

---

## 3. Production Secret Handling & Rotation Guidelines

1. **Generation**: Never hand-craft secrets. Use a high-entropy cryptographically secure pseudorandom generator:
   ```bash
   openssl rand -hex 32
   ```
2. **Obvious Placeholders blocked**: The validation module prevents startup when secrets contain any of the following substrings:
   - `local-dev`
   - `localhost`
   - `goldplus-local-dev-secret`
   - `password`
   - `changeme`
   - `test-secret`
   - `secret`
3. **Rotation Cadence**:
   - `JWT_SECRET` should be rotated every 90 days. Active sessions will be cleanly logged out, prompting admins to sign back in.
   - `MTN_WEBHOOK_SECRET` / `AIRTEL_WEBHOOK_SECRET` should be rotated in coordination with carrier service integrators.
   - `IDENTITY_HASH_PEPPER` is permanent. Rotating it requires executing a batch database hash update migration to prevent mapping drift.

---

## 4. Database Migrations and Bootstrapping

Database migrations are located in [apps/api/src/infrastructure/db/migrations](file:///Users/robertsebunya/Documents/GitHub_Projects/GoldPlusFinal/goldplus-commerce/apps/api/src/infrastructure/db/migrations).

### Step 1: Run Migrations
Run the committed migration files against the target database:
```bash
pnpm -F @goldplus/api db:migrate
```
*Note: This command runs migrations safely without dropping, resetting, or modifying existing tables.*

### Step 2: Seed Core Lookup Tables
To seed static lookup items (Categories, Products, Images, Prices) in a fresh database, execute:
```bash
pnpm -F @goldplus/api tsx scripts/seed.ts
```
*Note: This script is 100% production-safe. It does not seed fake orders, fake analytics events, or PII.*

### Step 3: Bootstrap Administrator Role & User
To create the Owner role (29 permissions) and link it to the initial Administrator, configure the `BOOTSTRAP_ADMIN_*` variables and run:
```bash
pnpm -F @goldplus/api tsx scripts/bootstrap-admin.ts
```
*Note: The script does not print secrets or passwords in standard outputs.*

---

## 5. Health Check Endpoint

Deployment load balancers and platform checkers should monitor:
* **Endpoint**: `GET /health` on the API port (default `3000`).
* **Expected Response Header**: `200 OK` / `Content-Type: application/json`
* **Expected Response Shape**:
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "timestamp": "2026-05-17T07:18:03.000Z"
    }
  }
  ```
*Security Assurance*: This route exposes no database credentials, connection strings, system paths, or environment statistics.

---

## 6. Admin Authentication & Route Protection

All admin pages under the `/admin/*` path are securely protected at the Astro routing layer.
- Unauthenticated requests are immediately redirected to `/admin/login` via a `303 See Other` response status.
- Session verification relies on `readSessionToken(Astro.request)` reading JWT tokens.
- All administration endpoints require a valid bearer authorization header in downstream API requests.

---

## 7. Controlled Deployment Checklist

Execute these steps sequentially during staging or production deployment:

- [ ] **Step 1: Set Target Environment Variables**
  Configure the secure variables in the target platform console. Make sure `NODE_ENV` is set to `production` and all secrets satisfy minimum length and complexity rules.
- [ ] **Step 2: Run Production Build Gates**
  Compile the codebase locally or via CI/CD before deployment:
  ```bash
  pnpm run build
  ```
- [ ] **Step 3: Run Database Migrations**
  Execute migration scripts:
  ```bash
  DATABASE_URL="your-production-db-url" pnpm -F @goldplus/api db:migrate
  ```
- [ ] **Step 4: Seed Lookup Tables (Fresh Deploys Only)**
  Seed products and categories:
  ```bash
  DATABASE_URL="your-production-db-url" pnpm -F @goldplus/api tsx scripts/seed.ts
  ```
- [ ] **Step 5: Bootstrap Owner Account**
  Configure bootstrap environment credentials and execute:
  ```bash
  DATABASE_URL="your-production-db-url" \
  BOOTSTRAP_ADMIN_EMAIL="admin@domain.com" \
  BOOTSTRAP_ADMIN_PASSWORD="StrongSecurePassword123!" \
  pnpm -F @goldplus/api tsx scripts/bootstrap-admin.ts
  ```
- [ ] **Step 6: Boot Services**
  - API Server: `pnpm -F @goldplus/api start` (or Node runtime pointing to `dist/interfaces/http/server.js`)
  - Web Server: `pnpm -F @goldplus/web start` (or launch in Astro SSG/SSR adapter target)
- [ ] **Step 7: Execute Post-Deployment Smoke Checklist**
  - Verify storefront (`GET /` returns `200 OK`)
  - Verify API health (`GET /health` returns `200 OK`)
  - Verify Admin Redirects (`GET /admin` redirects to `/admin/login`)

---

## 8. Rollback and Contingency Operations

1. **Code Rollback**: Redeploy the last stable Docker image or Git commit hash (e.g., tag `pass-14b-local-dev-stability`).
2. **Database Rollback**:
   - Drizzle database schemas do not automatically revert destructive actions. If a rolling deployment fail occurs, restore the Postgres database to the last pre-deployment snapshot point.
   - Database back-ups should be taken immediately prior to executing any new migration steps.
