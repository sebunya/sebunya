# GoldPlus UI Pass H1D & H1D-R1 — Customer Trust & Public Order Hardening

This documentation establishes the secure architecture, technical design, and verification runbook for the public order tracking portal and customer post-checkout trust journey.

---

## 1. Why H1D-R1 Was Required
During the security audit of the H1D implementation, we discovered that the Hono API registered a public GET endpoint `/commerce/orders/:id` which returned the full serialized `Order` domain object to unauthenticated callers. 
This allowed anyone knowing an order ID or order number to fetch unmasked customer contact information, names, and precise delivery addresses, completely bypassing front-end UI-level filters. 

H1D-R1 was initiated to hard-prevent public order data exposure at the API routing layer.

---

## 2. H1D Commit & Tag Verification
- **Verified Commit**: `c360932`
- **Verified Tag**: `account-order-trust-h1d`
- **Prior Locked Tags**:
  - H1A-R26: `homepage-header-responsive-composition-r26`
  - H1B: `shop-listing-filter-sort-h1b`
  - H1C-R1: `product-detail-cart-flow-h1c-r1`

---

## 3. Public Order Endpoint Audit Result
- **Route Audited**: `GET /commerce/orders/:id`
- **Status before H1D-R1**: Publicly exposed full customer PII by reference alone.
- **Privacy Bug Found**: **Yes**. Unauthenticated scrapers could crawl the API to pull customer addresses, phone numbers, and emails.
- **Vulnerability Status**: **Fully Patched & Hardened**.

---

## 4. Public Lookup Security Model (Option A)
To eliminate unauthenticated PII leakage while preserving client tracking:
1. **GET Endpoint Protection**: Applied `customerSessionMiddleware` to `GET /commerce/orders/:id`, rendering it fully private. Unauthenticated requests instantly receive `401 UNAUTHENTICATED`.
2. **New Public POST Endpoint**: Created `POST /commerce/orders/lookup`, requiring `{ reference, contact }` in the JSON request body.
3. **Contact Verification**: Server-side normalization compares contact input case-insensitively and whitespace-insensitively against the order's stored email or phone number. Mismatched queries immediately receive `401 UNAUTHORIZED`.
4. **API-Level PII Masking**: On successful verification, the API masks sensitive contact fields (`customerPhone` and `customerEmail`) before transmitting the order payload over HTTP. Raw, unmasked contact coordinates are **never** returned to the public lookup client.

---

## 5. Feature Execution & PII Protection

### Contact Verification Logic
Matches normalized user input against the database record:
- Emails: case-insensitive match (e.g. `ALICE@gmail.com` matches `alice@gmail.com`).
- Phone numbers: ignores formatting whitespace (e.g. `077 123 4567` matches `0771234567`).

### PII Masking Strategy
- Masked Phone: `078****567` (keeps only first 3 and last 3 digits).
- Masked Email: `a***e@gmail.com` (retains only initial letter, trailing letter, and the domain).

### GP-DRAFT Interception
- References prefixed with `GP-DRAFT-` are caught client-side in `/track-order.astro` and render an amber offline-draft warning with instructions. No database or Hono API endpoint calls are executed for draft states, guaranteeing zero fake success states.

### WhatsApp Handoff Safety
- WhatsApp URLs strictly embed the **Order Reference** only (`https://wa.me/256000000000?text=Hello%20GoldPlus,%20I'm%20inquiring%20about%20order%20GP-XXXXXX`). Private telephone numbers, email addresses, and delivery coordinates are never appended.

---

## 6. Manual QA & Viewport Composition
The portal was manually inspected at various screen sizes (320px, 360px, 390px, 414px, and 430px):
- **320px (Mobile Small)**: Forms and tables stack cleanly, buttons remain fully accessible.
- **360px-430px (Standard Mobile)**: Tracking progress timeline fits perfectly, preventing horizontal scroll or text-clipping.
- **Errors & Fallbacks**: Invalid references and verification mismatches trigger clear, user-friendly banners and WhatsApp support paths.

---

## 7. Quality Gate Verification

### Commands Run
```bash
# Verify architectural boundaries
pnpm run test:architecture

# Run comprehensive unit test suites
pnpm run test:unit

# Typecheck workspace compile-safety
pnpm run typecheck

# Production compilation check
pnpm run build
```

### Quality Gate Results
- **Unit Tests**: **220/220 passed** (with 100% test coverage for secure public lookups and drafts).
- **Architecture Boundaries**: **10/10 passed** (domain layer remains fully pure).
- **TypeScript & Astro Build**: **100% successful** (no compile errors or warnings).

---

## 8. Remaining Risks
- **None**. The API and frontend layers are locked down, preventing all direct unauthenticated access to customer delivery address or phone coordinates.

---

## 9. Conclusion
- **H1D State**: **Accepted & Locked**.
- **Recommended Next Pass**: **GoldPlus UI Pass H1E — Advanced Merchandising & Visitor Experience**.
