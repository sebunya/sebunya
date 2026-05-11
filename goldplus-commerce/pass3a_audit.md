# Pass 3A Implementation Audit

### 1. Current repo state
- `tailwind.config.mjs` uses legacy `#00A859`, `#FFD700` tokens.
- `BaseLayout.astro` and `index.astro` are coupled to `brand-gold` and have default SEO/lang tags.
- `manifest.json` specifies no icons and uses legacy color code.
- `sw.js` caches only static files and falls back to homepage `/` on failure.
- All payment repository structures (`IPaymentRepository`, `DrizzlePaymentRepository`), Use Cases (`RecordPaymentWebhookUseCase`), and endpoints (`/webhooks/payment/:provider`) are missing.
- No `/sitemap.xml`, `/robots.txt` or `/offline` exist.
- Schema validation: `payments` and `outboxEvents` tables ALREADY exist in drizzle schemas.

### 2. What from claude_push_2.txt is already done
- The database schema for the `payments` table (with `idempotencyKey`) and `outboxEvents` are already merged in `apps/api/src/infrastructure/db/schema`.

### 3. What from claude_push_2.txt is still missing
- All operational logic for webhook processing (Port, Adaptor, Case, Endpoint).
- Brand token specifications hardening and Backwards-compatible Aliases.
- UI cleanup removing `brand-gold` from homepage/layouts.
- Public manifest assets (SVGs) and manifest data replacement.
- SSR static generators for sitemaps/robots and static recovery page `offline.astro`.
- Test suites for webhooks and additional architecture boundary rules.

### 4. What from claude_push_2.txt must be corrected before implementation
- **IMPORTANT**: `apps/web/src/pages/offline.astro` contains an open/unclosed `href` assignment missing the `<a ` tag on the "Go to home" block. This MUST be corrected during generation.
- **CRITICAL**: `apps/api/src/interfaces/http/routes/webhooks.ts` executes `await useCase.execute(...)` outside the try-catch. Per user explicit correction requirement, this call must be wrapped INSIDE the try-catch to intercept `MISSING_ORDER` or connectivity throws correctly so it responds with a controlled 422/400 instead of 500.

### 5. Files I intend to create
- `apps/api/src/application/ports/IPaymentRepository.ts`
- `apps/api/src/application/use-cases/payments/RecordPaymentWebhookUseCase.ts`
- `apps/api/src/infrastructure/db/repositories/DrizzlePaymentRepository.ts`
- `apps/api/src/interfaces/http/routes/webhooks.ts`
- `apps/web/src/pages/offline.astro`
- `apps/web/src/pages/sitemap.xml.ts`
- `apps/web/src/pages/robots.txt.ts`
- `apps/web/public/icon-192.svg`
- `apps/web/public/icon-512.svg`
- `apps/web/public/maskable-icon.svg`
- `tests/unit/RecordPaymentWebhook.test.ts`

### 6. Files I intend to modify
- `apps/web/tailwind.config.mjs`
- `apps/web/src/layouts/BaseLayout.astro`
- `apps/web/src/pages/index.astro`
- `apps/web/public/manifest.json`
- `apps/web/public/sw.js`
- `apps/api/src/infrastructure/Registry.ts`
- `apps/api/src/interfaces/http/app.ts`
- `tests/architecture/boundaries.test.ts`

### 7. Files I intend to delete
- None.

### 8. Risks before implementation
- No critical breaking change risks, as the Tailwind config explicitly implements legacy aliases ensuring that other pages relying on `brand-green` or `brand-dark` continue building. Correcting execution scope in `webhooks.ts` removes the crash risk.
