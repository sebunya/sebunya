# Slice 5-A artifact review

Deployment shape: web-only scoped overlay.

Runtime files:

- `apps/web/src/pages/shop.astro` — public listing/search/filter/empty-state rendering.
- `apps/web/src/components/ProductCard.astro` — truthful price, availability, category cue, accessibility, and PDP-link copy.
- `apps/web/src/lib/product-discovery.ts` — pure web parameter normalization, approved taxonomy, matching, filtering, sorting, and product-ID deduplication.

Local-only files:

- `tests/unit/Slice05ProductDiscoveryP0.test.ts`
- `docs/platform/evidence/slices/slice-05-a-*.md`

Hard-excluded dirty-worktree files include all checkout/cart calculations, payment/PesaPal, orders, auth, ZeptoMail, WhatsApp, Template Studio, External Delivery, Measurement, queues, OAuth/SMS/CAPTCHA, recommendation and personalisation engines, Product Finder, compatibility, loyalty, environment files, credentials, backups, dumps, and logs. No excluded file is in the overlay.

Rollback files are the three runtime paths above. Restore them from the fresh pre-deployment source backup, rebuild `web`, and restart only `web`.
