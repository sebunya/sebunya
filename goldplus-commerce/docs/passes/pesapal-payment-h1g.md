# GoldPlus Pass H1G-P1 — PesaPal Backend Payment Foundation Runbook

This document details the architectural design, implementation details, and verification runbook for the PesaPal API 3.0 REST payment integration implemented in Phase H1G-P1.

---

## 1. PesaPal API 3.0 REST Integration

GoldPlus uses **PesaPal API 3.0** JSON endpoints for payment processing and verification. 

### Gateway Endpoints
*   **Sandbox Base URL**: `https://cybqa.pesapal.com/pesapalv3`
*   **Production Base URL**: `https://pay.pesapal.com/v3`

### API Lifecycle Sequence
```mermaid
sequenceDiagram
    participant Browser as Customer Browser
    participant Storefront as GoldPlus Storefront
    participant API as GoldPlus Backend API
    participant PesaPal as PesaPal REST API 3.0

    Browser->>Storefront: Click "Pay with PesaPal"
    Storefront->>API: POST /payments/pesapal/start
    API->>PesaPal: POST /api/Auth/RequestToken
    PesaPal-->>API: Return Short-Lived Bearer Access Token
    API->>PesaPal: POST /api/Transactions/SubmitOrderRequest (Bearer Token)
    PesaPal-->>API: Return OrderTrackingId & Redirect URL
    API-->>Storefront: Return Redirect URL & Merchant Reference
    Storefront-->>Browser: Redirect to PesaPal Page
    Note over Browser,PesaPal: Customer Pays via Mobile Money / Cards
    PesaPal-->>Browser: Redirect to /checkout/pesapal/callback (Customer Returns)
    Browser->>API: GET /payments/pesapal/callback
    API->>PesaPal: GET /api/Transactions/GetTransactionStatus (Authoritative Check)
    PesaPal-->>API: Status 1 (COMPLETED), Amount, Currency
    API->>API: Verify amount/currency/reference match
    API->>API: Update order to "paid" & "processing"
    API-->>Browser: Redirect back to /checkout/pesapal/callback?status=success
```

---

## 2. Configuration & Local Dev Setup

Payment credentials and endpoints are resolved dynamically at runtime using environment variables. All variables are optional during start/bootstrap to prevent build/test failures when secrets are omitted.

### Environment Variables (`apps/api/.env`)
```bash
# Gateway Mode ('sandbox' or 'production')
PESAPAL_ENV=sandbox

# PesaPal API 3.0 Customer Portal Credentials (never logged or serialized)
PESAPAL_CONSUMER_KEY=your_pesapal_consumer_key
PESAPAL_CONSUMER_SECRET=your_pesapal_consumer_secret

# Secured IPN ID registered in PesaPal Merchant Portal
PESAPAL_IPN_ID=your_registered_ipn_id

# Merchant & Currency Presets
PESAPAL_CURRENCY=UGX
PESAPAL_BRANCH="GoldPlus Kampala Main Branch"

# Redirection Targets
PESAPAL_CALLBACK_URL=http://localhost:3000/checkout/pesapal/callback
PESAPAL_CANCELLATION_URL=http://localhost:3000/checkout/pesapal/cancelled
```

---

## 3. Strict Verification & No-Fake-Paid Integrity Rules

To protect against request tampering, GoldPlus implements **strict authoritative transaction status verification**:
1.  **No Direct State Mutation**: Neither callback redirection query parameters nor IPN webhook payloads can set an order to "paid" directly.
2.  **Auth Call Enforcement**: The backend must request transaction status directly from PesaPal's `GetTransactionStatus` API using secure Bearer authentication.
3.  **Cross-Validation Integrity Routine**:
    *   **Merchant Reference**: Must match the original generated reference.
    *   **Total Amount**: Must match the exact amount registered in our `payment_attempts` table.
    *   **Currency**: Must strictly match the Ugandan Shilling (`UGX`) original record.
4.  **Failure State**: Any mismatch in amount, currency, or merchant reference immediately aborts processing, marks the attempt as `verification_failed`, and leaves the order unpaid.

---

## 4. Database Schema: Payment Attempts Ledger

To track multiple attempts safely without polluting the core `orders` table, a persistent Drizzle model is appended:

```typescript
export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  merchantReference: varchar('merchant_reference', { length: 255 }).unique().notNull(),
  orderTrackingId: varchar('order_tracking_id', { length: 255 }),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 10 }).default('UGX').notNull(),
  status: varchar('status', { length: 30 }).default('not_started').notNull(),
  redirectUrl: varchar('redirect_url', { length: 512 }),
  provider: varchar('provider', { length: 50 }).default('pesapal').notNull(),
  ipnReceivedAt: timestamp('ipn_received_at', { withTimezone: true }),
  callbackReceivedAt: timestamp('callback_received_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

---

## 5. Rollback Sequence

If critical production regressions occur:
1.  **Code Reset**: Roll back to the stable H1F catalogue admin baseline:
    ```bash
    git reset --hard product-catalogue-admin-h1f
    ```
2.  **Database Migration Reversion**: Apply Drizzle database migrations to drop the `payment_attempts` table.
3.  **Environment Deactivation**: Remove `PESAPAL_CONSUMER_KEY` and `PESAPAL_CONSUMER_SECRET` from server configurations. The storefront forms will automatically fall back to local drafts/offline demo modes safely.

---

## 6. GoldPlus Pass H1G-P2-LIVE — Controlled Live Checkout Activation

This section details the implementation of our production payment activation pass.

### A. Live Environment Strategy
*   **Production API Target**: `https://pay.pesapal.com/v3`
*   **Sandbox API Target**: `https://cybqa.pesapal.com/pesapalv3` (Used in sandbox mode)
*   **Operational Directives**:
    *   Do not ask for keys or print secrets.
    *   Rejects localhost callback/cancellation URLs in production/live mode.
    *   Refuses non-HTTPS redirect callback/cancellation destinations in live mode.

### B. Environment Configuration Placeholders (`.env`)
```bash
PESAPAL_ENV=live
PESAPAL_BASE_URL=https://pay.pesapal.com/v3
PESAPAL_CONSUMER_KEY=your_live_consumer_key_here
PESAPAL_CONSUMER_SECRET=your_live_consumer_secret_here
PESAPAL_IPN_ID=your_registered_live_ipn_id
PESAPAL_CURRENCY=UGX
PESAPAL_COUNTRY_CODE=UG
PESAPAL_REDIRECT_MODE=TOP_WINDOW

# Production targets
PESAPAL_CALLBACK_URL=https://your-storefront-domain.com/checkout/pesapal/callback
PESAPAL_CANCELLATION_URL=https://your-storefront-domain.com/checkout/pesapal/cancelled
PESAPAL_IPN_URL=https://your-api-domain.com/commerce/payments/pesapal/ipn
```

### C. Mounted Routes & Forensic Double-Prefix Audit
*   **Forensic Verification**: Audited the mounted endpoint maps. **No double `/commerce/commerce` route path exists**.
*   **Mounted Routes**:
    *   `POST /commerce/payments/pesapal/start` (Initial payment request)
    *   `GET /commerce/payments/pesapal/callback` (Return handler)
    *   `POST /commerce/payments/pesapal/ipn` (Incoming transactional webhook status settlement)

### D. Storefront Integration Details
*   **Checkout payment selector**: Added an interactive selector card inside `/checkout` presenting:
    1.  *Cash / Manual Invoice* (Offline submission)
    2.  *Mobile Money & Card via PesaPal* (Instant secure online redirection)
*   **Zero-Trust Cart Handling**: The shopping cart cookie is **preserved** during checkout submission and PesaPal redirection. It is strictly **cleared** only when returning to our callback landing page once the server authoritatively verifies that status is `COMPLETED`.
*   **Unpaid State Enforcement**: Cancelled and pending sessions are represented truthfully. Orders are kept strictly in the `unpaid` state until a secure status confirmation is retrieved from `GetTransactionStatus`.

### E. Tests Added/Updated
1.  Sandbox client supports localhost domains.
2.  Live client strictly rejects non-HTTPS redirection paths with `PESAPAL_LIVE_GUARD_VIOLATION`.
3.  Live client strictly rejects localhost or staging domains in production with `PESAPAL_LIVE_GUARD_VIOLATION`.

### F. Quality Gates Compliance
*   **TypeScript Compilation**: 100% green.
*   **Unit Tests**: 267/267 passing cleanly.
*   **DDD Boundaries Checks**: 10/10 passing cleanly.
*   **Production Bundling**: Flawless Hono server and Astro client SSR compilation.

### G. Recommendation/Admin Freeze
All recommendation engines, visitor intelligence rails, merchandising modules, and tracking keys remain completely untouched and frozen. No risks of merchandising regression exist.

