# Pass 14B: Local Dev Stability & Demo Reliability Guide

This document outlines the stability status of the GoldPlus Commerce local development environment after **Pass 14A (System-Wide Date Range Validation)** and provides a practical checklist for developers and presenters to verify dev stability and demo readiness.

---

## 1. Disk Space Status
* **Status**: **RESOLVED**
* **Confirmation**: Available disk space has been verified as sufficient (2.5Gi+ available). Disk pressure is fully resolved.
* **Instruction**: Do not perform any aggressive disk cleanup, `pnpm store prune`, `docker system prune`, or cache deletions during standard dev cycles unless explicitly instructed.

---

## 2. Port & Process Management
GoldPlus operates on three critical local ports:
* **Port `3000`**: GoldPlus REST API Server (Node/TSX)
* **Port `4321`**: GoldPlus Commerce Storefront & Admin Console (Astro)
* **Port `5432`**: PostgreSQL Database Server

### How to Check Port Allocations
Run the following commands to check for port conflicts or active instances:
```bash
lsof -i :3000
lsof -i :4321
lsof -i :5432
```
*Note: Do not kill the database process unless it is stale and unresponsive. Only restart dev servers if changes fail to hot-reload.*

---

## 3. Starting the Development Servers
Before launching dev services, ensure your `.env` file is fully configured.

### Starting Dev Servers in Parallel
Use the workspace-wide command to boot all services (API, web frontend) concurrently:
```bash
set -o allexport
source .env
set +o allexport
pnpm run dev
```

---

## 4. Checking Database Health
Ensure your PostgreSQL instance is running and fully seeded with core ecommerce entities.

### Verification Commands
```bash
# 1. Check if Postgres is listening locally
nc -zv localhost 5432

# 2. Ping the database and run a test query
psql "$DATABASE_URL" -c "SELECT 1;"

# 3. Check core table populations
psql "$DATABASE_URL" -c "SELECT count(*) FROM products;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM recommendation_events;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM identity_links;"
```

---

## 5. Bootstrapping the Admin Account
If running in a clean environment or if the admin account needs to be seeded, use the secure bootstrap script:

```bash
set -o allexport
source .env
set +o allexport
npx tsx scripts/bootstrap-admin.ts
```
*Note: This script will verify existing permissions, attach the `Owner` role, and seed the primary administrator safely without overwriting live user passwords.*

---

## 6. Route Smoke Testing
Verify that all core storefront routes and protected admin routes return expected HTTP statuses.

### Storefront Routes (Expected: 200 OK)
* Homepage: `http://localhost:4321/`
* Product Detail Page: `http://localhost:4321/products/wireless-earbuds`
* Shopping Cart: `http://localhost:4321/cart`

### Protected Admin Routes (Expected: 303 Redirect to login if unauthenticated)
* Admin Login: `http://localhost:4321/admin/login` (Returns `200 OK`)
* Analytics Dashboard: `http://localhost:4321/admin/recommendations/analytics`
* Recommendation Rules: `http://localhost:4321/admin/recommendations/preview`

Verify status codes instantly via curl:
```bash
curl -I http://localhost:4321/
curl -I http://localhost:4321/products/wireless-earbuds
curl -I http://localhost:4321/admin/recommendations/analytics
```

---

## 7. Date Validation Smoke Checks (Pass 14A Verification)
Pass 14A introduced system-wide date range and chronology validation. Verify this behavior with three quick checks:

### Check A: Chronological Enforcement (Invalid Range)
* **Action**: Open `/admin/recommendations/analytics?startDate=2026-05-16&endDate=2026-05-10` in your browser.
* **Expected Result**: A friendly, elegant validation error UI is displayed. The page does not crash, and no 500 error occurs.

### Check B: Same-Day Boundaries (Valid Range)
* **Action**: Open `/admin/recommendations/analytics?startDate=2026-05-10&endDate=2026-05-10` in your browser.
* **Expected Result**: The range is accepted cleanly without a chronology error, and the analytics dashboard loads.

### Check C: Rule Creation Date Render
* **Action**: Open `/admin/recommendations/rules/new` in your browser.
* **Expected Result**: The `Active From` and `Active Until` date fields render correctly. Subtext and helper validation hints are fully visible.

---

## 8. Security & Environment Governance
> [!IMPORTANT]
> **Strict Environment Rules**:
> 1. **Do not commit `.env` files** to the repository. The `.gitignore` enforces this rule.
> 2. **Rotate all secrets** (including `JWT_SECRET`, `MTN_WEBHOOK_SECRET`, `AIRTEL_WEBHOOK_SECRET`, and `IDENTITY_HASH_PEPPER`) prior to any staging or production deployment.
> 3. Never print or log raw secrets during boot check or diagnostic scripts.
