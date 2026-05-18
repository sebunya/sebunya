# GoldPlus Commerce Production Deployment & PesaPal Activation Runbook

This document outlines the deployable architecture, DNS/SSL configurations, production environment requirements, and the strict post-deployment activation gate for the PesaPal live payment system on GoldPlus.

---

## 1. Release Baseline & Status

*   **Current Code Baseline**: `H1G-P2-LIVE` (Checkout UI Integration Lock)
*   **Committed Release Tag**: `pesapal-live-checkout-h1g-p2`
*   **API Integrity Checks**: Global typescript checks and Vitest (267 unit & 10 architecture tests) are 100% green.
*   **Production Handshake Status**: Outgoing token preflight handshake successfully authenticated with PesaPal's production system (`https://pay.pesapal.com/v3`). Live merchant keys are active and verified.
*   **Deployment Blockers**: Webhook/IPN registration and live redirect URL smoke tests are **actively blocked** by unconfigured/unpropagated production DNS and origin hosting connection timeouts.

---

## 2. DNS / SSL Blocker Registry

Before live payments can be registered or processed, the network infrastructure must resolve successfully:

| Host Domain | Expected Endpoint Target | Current Status | Blocker Description / Owner |
| :--- | :--- | :--- | :--- |
| `shopgoldplus.com` | Storefront public web server | **HTTP/2 522** (Cloudflare Edge Timeout) | Cloudflare DNS resolves to the edge proxy, but the proxy times out attempting to establish a TCP handshake with the hosting origin. Owner: **Hosting Origin / Web Server** |
| `api.shopgoldplus.com` | API backend server | **Could Not Resolve** (DNS Failure) | The DNS records (CNAME / A record) are not yet configured or propagated for the API backend host. Owner: **DNS Domain Registrar / Cloudflare DNS Console** |

### Cloudflare 522 Origin Timeout Fix Checklist:
1.  [ ] **Service Process**: Verify that the Astro Node server application is booted and listening on the designated port (e.g. `4321` or `3000`).
2.  [ ] **Address Binding**: Confirm the server entrypoint binds to `0.0.0.0` (all network interfaces) rather than `127.0.0.1` inside Docker or the hosting provider environment.
3.  [ ] **Reverse Proxy / Nginx**: Verify Nginx/Apache configuration passes headers and redirects traffic to the local port cleanly.
4.  [ ] **Firewall Ports**: Confirm ports `80` (HTTP) and `443` (HTTPS) are fully open on the origin server for Cloudflare edge IPs.

---

## 3. Workspace Build & Run Architecture

### Engines Requirements
*   **Node.js**: `>=20.0.0`
*   **pnpm**: `>=8.0.0`

### Workspace Build Commands
*   **Global Build**: `pnpm run build` (Compiles both `@goldplus/api` and `@goldplus/web` workspaces).
*   **Web Only Build**: `pnpm -F @goldplus/web build`
*   **API Only Build**: `pnpm -F @goldplus/api build`

### Runtime Start Commands
*   **API Service**: `node apps/api/dist/interfaces/http/server.js` (or `pnpm -F @goldplus/api start`)
*   **Web Front-end**: `node apps/web/dist/server/entry.mjs` (Astro SSR server entrypoint, or `pnpm -F @goldplus/web preview`)

### Database Migration
*   **Command**: `pnpm db:migrate` (runs `tsx src/infrastructure/db/migrations/migrate.ts` inside `@goldplus/api` workspace to sync schemas with PostgreSQL).

---

## 4. Production Environment Checklist (Redacted)

These variables must be populated inside your production environment console or host secrets manager. **Do not commit these values to source control.**

| Environment Variable | Category | Purpose | Status |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | DB Configuration | PostgreSQL connection string | Required |
| `JWT_SECRET` | Auth / Security | Signature secret for session JSON Web Tokens | Required |
| `BOOTSTRAP_ADMIN_EMAIL` | Admin Identity | Initial administrator email for the system | Required |
| `BOOTSTRAP_ADMIN_PASSWORD` | Admin Identity | Initial administrator password | Required |
| `BOOTSTRAP_ADMIN_PHONE` | Admin Identity | Initial administrator mobile number | Required |
| `PUBLIC_API_BASE_URL` | Integration | Public endpoint of the API backend (`https://api.shopgoldplus.com`) | Required |
| `PESAPAL_ENV` | Payment Gateway | Set to `live` for production PesaPal | Required |
| `PESAPAL_BASE_URL` | Payment Gateway | Set to `https://pay.pesapal.com/v3` | Required |
| `PESAPAL_CONSUMER_KEY` | Payment Gateway | Production key from your PesaPal Merchant Portal | Required |
| `PESAPAL_CONSUMER_SECRET`| Payment Gateway | Production secret from your PesaPal Merchant Portal | Required |
| `PESAPAL_CURRENCY` | Payment Gateway | Default checkout currency (`UGX`) | Required |
| `PESAPAL_COUNTRY_CODE` | Payment Gateway | Target merchant country (`UG`) | Required |
| `PESAPAL_BRANCH` | Payment Gateway | Merchant branch identifier label | Required |
| `PESAPAL_REDIRECT_MODE` | Payment Gateway | Redirect behavior (`TOP_WINDOW`) | Required |
| `PESAPAL_CALLBACK_URL` | Payment Gateway | `https://shopgoldplus.com/checkout/pesapal/callback` | Required |
| `PESAPAL_CANCELLATION_URL`| Payment Gateway | `https://shopgoldplus.com/checkout/pesapal/cancelled` | Required |
| `PESAPAL_IPN_URL` | Payment Gateway | `https://api.shopgoldplus.com/commerce/payments/pesapal/ipn` | Required |
| `PESAPAL_IPN_ID` | Payment Gateway | Unique GUID returned from registration | **Required Post-DNS** |
| `MTN_WEBHOOK_SECRET` | Mobile Money | MTN payment notification validation key | Required |
| `AIRTEL_WEBHOOK_SECRET` | Mobile Money | Airtel payment notification validation key | Required |

---

## 5. PesaPal Post-Deployment Activation Gate

> [!IMPORTANT]
> **DO NOT register the live IPN URL with PesaPal until all of the following conditions are met:**

1.  **Web Storefront resolves**: `https://shopgoldplus.com` DNS resolves.
2.  **No Cloudflare timeouts**: `https://shopgoldplus.com` responds with HTTP 200/302 cleanly (no HTTP 522/502).
3.  **API Backend resolves**: `https://api.shopgoldplus.com` resolves successfully to your production host.
4.  **API HTTPS responses**: `https://api.shopgoldplus.com` responds correctly over HTTPS.
5.  **IPN Route availability**: `POST /commerce/payments/pesapal/ipn` is live and reachable externally.
6.  **Token Handshake Validation**: The live PesaPal token handshake check continues to pass successfully.
7.  **Webhook target**: Configured IPN endpoint matches `https://api.shopgoldplus.com/commerce/payments/pesapal/ipn` exactly.
8.  **Explicit User Approval**: The merchant owner explicitly approves webhook registration in the console.

### Controlled Redirect URL Smoke Test Gate:
Once the IPN ID is registered and populated in the production server's environment config:
1.  Create an internal test order for `UGX 100` (or smallest valid amount).
2.  Call payment initiation from the checkout page.
3.  Confirm PesaPal returns a `redirect_url` pointing to `https://pay.pesapal.com/...` successfully.
4.  **DO NOT complete the payment** and verify the order state remains strictly `pending` and `unpaid`.

### Live Charge Settlement Verification:
Only after successful smoke testing:
1.  Confirm explicit user approval for a live charge.
2.  Complete a real `UGX 100` payment using mobile money / card.
3.  Confirm callback redirection updates storefront cookie status correctly.
4.  Verify PesaPal sends a POST webhook to `/commerce/payments/pesapal/ipn`.
5.  Verify the backend queries `/api/Transactions/GetTransactionStatus` authoritatively, receiving `COMPLETED`, before updating order state to `paid`.

---

## 6. Rollback & Disaster Recovery Plan

If deployment fails or structural service errors occur:
1.  **Immediate Revert**: Roll back the active branch to the previous stable release tag: `visitor-merchandising-h1e-r2` or `product-catalogue-admin-h1f`.
2.  **Data Isolation**: Ensure db tables added for `paymentAttempts` and order modifications do not block rollback. (Drizzle schema migrations are purely additive and backward-compatible).
3.  **Checkout Fallback**: If PesaPal integrations are disabled/rolled back, the checkout selector gracefully defaults to Offline Cash/Invoice submission automatically.
