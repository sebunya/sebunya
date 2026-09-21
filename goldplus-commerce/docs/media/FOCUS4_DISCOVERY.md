# Focus 4 — Discovery (Phase A)

Date: 2026-09-21. Branch `focus4/product-gallery` off `b580b3e5` (tip of `deploy/price-floor-145k`, which is what production runs plus docs). Working tree clean at start. Governing instructions: `CLAUDE.md` (Clean Architecture, mutations only through use cases, no invented product facts, PWA cache excludes sensitive routes, tests + architecture checks mandatory) and the Focus 4 master prompt (no push, no deploy, no production data change, no invented photography).

Every claim below carries a `file:line` from a read of the code on this commit, or a read-only production query with its timestamp. Unknowns are written as unknown.

## 1. Corrected assumptions in the brief

| Brief said | Repository says | Decision |
|---|---|---|
| Lime `#96CC06`, Montserrat | `brand.primary = #93D500`, `brand.primaryInk = #456B00` (only legal green for text on light), font Plus Jakarta Sans self-hosted (`apps/web/tailwind.config.mjs:6-28`, `public/fonts/faces.css`) | Use the repository tokens. Do not introduce a second green or font. |
| "Existing variant rules" | There is **no variant selector and no quantity control** on the PDP; quantity is hard-coded 1 (`apps/web/src/pages/products/[slug].astro:548-578`) | Purchase hierarchy step 4 is Add to cart + Buy now only. |
| Stack: Astro/TS, Hono, Drizzle, Postgres, Redis | Confirmed. Storefront has no framework islands: plain `<script>` modules per `.astro` file (`[slug].astro:727`), HeroSlider is vanilla JS. | Gallery controller = one small vanilla module, progressively enhanced. |
| "180+ assets" | Production holds **26 assets** (see §4). The owner's three local folders hold 40 masters, all already uploaded. | 180 is a scale requirement for the import; fixtures will prove it. No real product has four frames today. |

## 2. Media authority today (evidence)

| Topic | Finding | Evidence |
|---|---|---|
| Gallery rows | `product_images(id, product_id, url, alt_text, display_order int default 0, is_primary bool, asset_id → media_assets ON DELETE SET NULL, created_at)`. **No unique constraint of any kind**, no version column, no reorder write path. | `apps/api/src/infrastructure/db/schema/phase11.ts:17-27`; migrations `0003` (create), `0076` (asset_id) |
| Assets | `media_assets` content-addressed: `checksum_sha256` UNIQUE, `storage_key = uploads/assets/<sha[0:2]>/<sha[0:12]>/<file>`, `status ACTIVE|ARCHIVED` only (no PROCESSING/FAILED) | `schema/media.ts:13-43`; `MediaLibraryUseCase.ts:82-102` |
| Renditions | `media_asset_variants(asset_id, purpose thumb160/card480/pdp1024/zoom2048, format avif/webp/jpeg)` UNIQUE (asset, purpose, format); generated **synchronously inside the upload request**, never upscaled, silently absent if sharp fails | `schema/media.ts:45-64`; `infrastructure/media/SharpVariantGenerator.ts:11-22,55,77-80`; `MediaLibraryUseCase.ts:105-113` |
| Usage tracking | `media_usages` UNIQUE (asset, entity, entity_id, field). Written by exactly one path (`assignToProduct`), cleaned by none. | `MediaLibraryUseCase.ts:168`; `RemoveProductImageUseCase` never deletes usages |
| Cover concept | Three overlapping notions with no DB guarantee: `is_primary` + `display_order`; the denormalised mirror `products.image_url/has_image`; and three JS + two SQL "pick primary" implementations | `toProductPublicDto.ts:67-69`, `SearchUseCases.ts:18-20`, `DrizzleProductRecommendationReader.ts:196-198`, `DrizzleSeoGrowthRepository.ts:591`, `DrizzleBatteryFinderRepository.ts:18` |
| THE display resolver | `mediaDisplayUrl.ts` maps a row to its `pdp.webp` rendition, else the original. Six repositories use it; the admin product list, product-finder, recommendation fallback, battery-compat search and hero slides **bypass it** and serve raw originals. | `apps/api/src/infrastructure/db/mediaDisplayUrl.ts:17-43`; bypasses at `DrizzleProductRepository.ts:195`, `DrizzleProductRecommendationReader.ts:222`, `ProductFinderRecommendationEngine.ts:183`, `routes/seo.ts:352`, `admin/hero.astro:250` |
| Two upload pipelines | Library path: magic-byte MIME allow-list png/jpeg/webp/avif/gif, 15 MB, ≤20 files, checksum dedupe, renditions. Legacy path `POST /admin/products/:id/images/upload`: jpeg/png/webp, 5 MB, ≤8 files, **no asset row, no renditions**. | `MediaLibraryUseCase.ts:24-45`; `UploadProductImagesUseCase.ts:28-90`; `ImageFileValidator.ts:10-12` |
| Pixel limits | None anywhere. sharp decodes whatever arrives. | grep of media use cases and generator |
| Storage | Named volume `media_uploads` at `/data/media` (api) and `/srv/media:ro` (Caddy) | `docker-compose.production.yml:197,206,310,396` |
| Edge cache | Caddy: existing file → `public, max-age=31536000, immutable`; missing → `no-store`. PDP HTML: no Cache-Control. Cloudflare purge is a manual script nobody calls. | `Caddyfile:59-70,77-101`; `scripts/cf-purge-urls.sh` |
| Service worker | Product pages are never cached (navigate → network-first). `/uploads/assets/**` → cache-first, never revalidated, **no size cap**. | `apps/web/public/sw.js:11-32,59-79` |
| Queues | Outbox with lease/backoff + BullMQ (degrade-to-inline). No image job exists. | `schema/system.ts:16-54`; `ProcessOutboxBatchUseCase.ts`; `QueueService.ts:30-45` |
| Audit | `audit_logs.entity_id` is `uuid NOT NULL`; non-UUID refs go through `auditEntityId()`; batches mint `randomUUID()` | `schema/system.ts:5-14`; `domain/audit/AuditEntityId.ts:24-29`; `routes/admin/media.ts:191-193` |
| Optimistic concurrency precedent | `expectedVersion` on every mutation step; repo returns null on mismatch; use case throws `STALE_VERSION` | `BatteryImportUseCases.ts:129-148,343-345` |
| Reviewed import precedent | upload → map → preview (dry run) → approve (**four eyes**: uploader ≠ approver) → apply → rollback, with `previewDigest` | `BatteryImportUseCases.ts:98-527`; routes `admin/battery-imports.ts`; UI `admin/batteries/imports/*.astro` |
| Photo→product matcher | Pure domain `planPhotoAttachments` → matched / unmatched / ambiguous / refused | `apps/api/src/domain/media/PhotoCodeMatcher.ts:57` |
| CSV safety | Single chokepoint `csvSafeCell` neutralises `= + - @` | `apps/api/src/domain/pricing/CsvSafe.ts`; `interfaces/http/csv.ts:12` |

## 3. Cover consumers (every read path)

Full table in the survey; the summary that drives the design:

| Consumer | Read path today | Snapshot? | Action |
|---|---|---|---|
| PDP image | `product.primaryImageUrl` single `<img>` 800×800 declared, **no srcset/sizes/fetchpriority** | no | Replace with gallery component (Slot 1 SSR + previews) |
| PDP OG / JSON-LD | `primaryImageUrl` via BaseLayout / `ProductJsonLd.astro:51` | no | OG = Slot 1; JSON-LD image array in slot order |
| Shop / hub cards, ItemList JSON-LD, category gating, home highlights, compare, blog related | `primaryImageUrl` (+ `productSrcset`) | no | Unchanged reads; the DTO's `primaryImageUrl` becomes Slot-1-first |
| Search dropdown, recommendation rails (4 placements), recently viewed, nav featured, battery finder | `imageUrl` from readers with their own "primary" pick | localStorage only (recently viewed, refreshed live) | Route every pick through one resolver |
| Cart page | `GET /products?limit=100` → map id→`primaryImageUrl` | **none stored** | Unchanged (pre-existing >100 fragility noted) |
| Checkout, order detail, `order_items`, `cart_items`, `product_feed_items`, email/SMS | **no image read and no image column** | none | Historical-snapshot policy: nothing to preserve; document |
| Merchant feed | `displayImageUrlSql` + `array_agg` of all images → `g:image_link` + `g:additional_image_link`; 15-min in-process cache | 15-min cache | Order becomes slot order; cache TTL documented as the propagation bound |
| llms.txt / Markdown for agents | `images.slice(0,10)` | no | Slot order |
| Admin product list / detail | legacy `products.image_url` / `images[0]` | no | Read Slot 1 through the resolver |
| Hero slides | admin-typed literal image path | hand-copied | Out of scope; noted |
| Image sitemap | absent | — | Out of scope (noted as gap) |

## 4. Verified inventory (production, read-only, 2026-09-21 08:22 UTC)

| Measure | Value |
|---|---|
| Products total / active | 192 / 183 |
| Active products with 1 image / with >1 / with 0 | 23 / **0** / **160** (29 of all 192 products have an image) |
| `product_images` rows | 29, all `is_primary = true`, all `display_order = 0`, all with `asset_id`, 26 distinct URLs (three assets shared by two products each) |
| `media_assets` | 26, all `image/webp`, all ACTIVE, all with dimensions, 2.5 MB total, **0 exact duplicates, 0 unassigned** |
| Media volume | 269 files, 7.2 MB (107 webp, 81 jpg, 81 avif renditions) |
| GP03BT | one asset 1600×1600 webp 115 kB, `/uploads/assets/93/938bb591fb3f/GP03BT.webp` |
| Owner's local masters | 10 JPG packaging shots + 7 PSD + 23 renders = 40 files; all already attached (they ARE the 26 assets after dedupe/flatten) |
| Naming patterns | mix of `SKU.webp` (`GP-C08.webp`) and descriptive (`goldplus-usb-sound-card.webp`); no `SKU__NN-role` names exist |
| Broken references | 0 (every asset has a file; repair script last ran 2026-09-01) |
| Ambiguous candidates | 0 unassigned assets, so none today |

Consequence: **no product can be a real four-image pilot.** Pilots use the real single image plus clearly labelled test fixtures; the handoff must say so.

## 5. Baseline measurements (Playwright, Chromium 1.61, `gp_probe` cookie so the visit is excluded from analytics)

Evidence: `docs/media/evidence/baseline-2026-09-21/` (fold + full-page screenshots, `baseline.json` with element positions, section order, image requests).

| Page | Viewport | Add to cart top (CSS px) | Fold | Image requests / bytes |
|---|---|---|---|---|
| GP03BT | 1440×900 @1 | **1700** | 900 | 11 / 129 kB |
| GP03BT | 390×844 @3 | **2235** | 844 | 6 / 224 kB |
| GP-39LT9 (battery) | 1440×900 | 1060 | 900 | 7 / 31 kB |
| GP-39LT9 | 390×844 | 1526 | 844 | 3 / 70 kB |
| GP-C08 (charger) | 1440×900 | 1389 | 900 | 9 / 69 kB |
| GP-C08 | 390×844 | 1931 | 844 | 4 / 98 kB |

The brief's observed 1700.5 px for GP03BT is reproduced. On every sampled page the buying action sits below the first screen at both widths. Cold/warm split, DPR variants and five-run medians are captured in Phase E, not here.

## 6. Existing test and gate infrastructure

`pnpm test` (vitest unit + integration + architecture; integration needs `scripts/integration-env.sh`), `pnpm test:architecture` (18 suites incl. `admin-route-authentication`, `domain-purity`, `web-nav-links-resolve`), `pnpm test:e2e` (Playwright, axe gate at `tests/e2e/accessibility.spec.ts` — **`/products/:slug` is not in its route list**), `pnpm images:check` (static budgets only; `/uploads` is out of its scope), `scripts/lighthouse-watch.sh` (home + shop only), `scripts/integration-on-clone.sh` (real-Postgres run on a production copy, on the host). Existing budgets: `apps/web/static-images.config.json` (`products` ≤2048 px/260 kB) — no budget exists for uploaded media or for gallery JS/CSS, so the brief's provisional targets apply (controller ≤10 KiB gz, CSS ≤5 KiB gz, thumbnail ≤20 kB, mobile cover ≤200 kB).

## 7. Decisions (recorded before coding)

| # | Decision | Why |
|---|---|---|
| D1 | **Extend `product_images`, do not add a new table.** Add `slot smallint NULL CHECK (slot BETWEEN 1 AND 4)`, partial UNIQUE `(product_id, slot) WHERE slot IS NOT NULL`, partial UNIQUE `(product_id, asset_id) WHERE asset_id IS NOT NULL`, `updated_at`. Add `products.media_revision integer NOT NULL DEFAULT 0`. | Every consumer already reads `product_images`; 29 rows to backfill; expand/backfill/switch stays additive. |
| D2 | **Slot 1 is the cover.** `is_primary` and `display_order` become a one-way projection written only by the mutation service (`is_primary = slot = 1`, `display_order = slot − 1`); `products.image_url/has_image` likewise. Legacy writers (`add`, `setPrimary`, `remove`, `assignPrimaryProductImage`, `attach-by-code/apply`, battery `setPrimaryImageFromAsset`) are routed through the service. | One authority; old readers keep working during the switch. |
| D3 | **Constraint-safe slot map write**: lock the `products` row (`FOR UPDATE`), compare `media_revision`, validate the whole map, set every existing gallery row's `slot` to NULL, then write the new slots, in one transaction. NULL is not "slot 0/5"; it is the legacy/unassigned state the partial index ignores. Deferrable constraints are not needed. | Proven pattern without temporary illegal values; assignment ids stay stable. |
| D4 | **One cover resolver**: `resolveGallery(rows)` in `packages/shared` (slot order; rows with NULL slot fall back to `is_primary desc, display_order asc` only for not-yet-migrated products) used by the DTO mapper, search, recommendation reader; SQL readers use `ORDER BY slot NULLS LAST, is_primary DESC, display_order ASC`. | Replaces three JS + two SQL implementations. |
| D5 | **No new cache invalidation job.** Rendition URLs are content-addressed and immutable; PDP HTML is not cached by Caddy or the SW; the merchant feed's 15-min in-process cache is the only propagation bound and is documented. The mutation writes an audit row in the same transaction; an outbox event is not needed because there is nothing durable to purge. | Do not build infrastructure for a cache that does not exist. |
| D6 | **Historical snapshots**: orders, carts, emails and feeds store no image, so there is nothing to preserve or rewrite. Policy recorded: if a future order snapshot is added it captures Slot 1 at transaction time. | Evidence in §3. |
| D7 | **Only READY assets can be assigned**: ACTIVE, file present, has at least the `pdp`/webp variant. Legacy-path uploads (no asset row) cannot enter a slot until re-ingested through the library; they remain visible through the legacy fallback. | Renditions are what the storefront serves. |
| D8 | **Reviewed import** clones the battery-import shape (session → plan → four-eyes approval → per-product apply with a ledger → recovery). Filename convention `SKU__01-main.ext`; the existing `PhotoCodeMatcher` provides the SKU token rules; manifests CSV/JSON. `/admin/photos` (unreviewed two-step) stays for now and is marked superseded. | Reuse the house pattern; the brief forbids a second permission or queue system. |
| D9 | **Gallery telemetry** is one `product_gallery_viewed` event through the existing telemetry SDK (`track()`), emitted only after a requested image commits, never on hydration/resize, and dropped for declared automation like every other event. It is not routed into `recommendation_events`. | Adding a recommendation event type would need classification in the shared vocabulary and would land in the personalisation tables; the telemetry collector is the documented sink for interaction events. |
| D10 | **Feature switch** `PRODUCT_GALLERY_ENRICHMENT` (default on; `'false'` shows Slot 1 only) following the `=== 'false'` convention, not a flag table. | Matches `PROFILE_READ_PURE` et al. |
| D11 | **Service worker**: bump `CACHE_NAME` is not needed; add `zoom` to nothing (the storefront will not request the 2048 tier). Document the unbounded cache-first rule as a pre-existing risk. | Scope. |
| D12 | **Design tokens**: `#93D500` accents on dark only; `#456B00` for green text on white; Plus Jakarta Sans; `rounded-2xl` cards, `rounded-full` pill buttons; focus ring `focus-visible:ring-4 ring-brand-primary/30`. | Repository truth. |

## 8. Requirement → implementation → test matrix

| Requirement (brief §) | Implementation | Test |
|---|---|---|
| One cover, slots 1–4, unique slot and asset per product (§2, §7) | migration `0148_product_media_slots.sql`; `ProductMediaSlotMap` domain (pure); `ProductMediaMutationService` use case | `tests/unit/ProductMediaSlotMap.test.ts` (swap, replace, remove-cover refusal, undo revision); `tests/integration/ProductMediaMutation.integration.test.ts` (constraints, concurrent writers, empty gallery) |
| Set-as-cover swap, remove-cover atomic replacement, undo with revision (§2) | same service, actions `SET_COVER/REPLACE/REMOVE/MOVE/UNDO` | unit + integration |
| Backfill Slot 1 from verified current primary, resumable, never overwrite newer (§8) | `scripts/backfill-product-media-slots.ts` (dry-run default, checkpoint by product, skips products whose `media_revision > 0`) | `tests/unit/BackfillProductMediaSlots.test.ts` (empty, legacy, partial, broken legacy, rerun, operator-edited) |
| One cover resolver, all consumers (§8) | `packages/shared/src/media/resolveGallery.ts`; mapper/search/reader/SQL updated | `tests/unit/GalleryResolver.test.ts`; `tests/architecture/single-cover-resolver.test.ts` (no other `isPrimary` sort survives) |
| PDP gallery: SSR Slot 1, previews exclude active, ordinal counter, finite controls, no autoplay (§2, §4, §5) | `apps/web/src/components/product/ProductGallery.astro` + `productGallery.ts` controller | `tests/unit/ProductGalleryState.test.ts` (A→B pending→A; A→B→C, B fails; failed thumb; failed cover); Playwright `tests/e2e/product-gallery.spec.ts` |
| Focus never stranded; keyboard Left/Right/Home/End local; one polite announcement (§5) | controller with stable focusable region | unit (state) + Playwright keyboard test |
| Purchase hierarchy: action visible at 1440×900, before details at 390×844 (§4) | `[slug].astro` restructure | Playwright geometry check on GP03BT fixture; screenshots in evidence |
| Responsive images: srcset/sizes, no eager secondaries, thumb tier for previews (§6) | `PDP_SIZES`, `productSrcset` reuse; `loading=lazy` thumbs; large rendition on intent only | Playwright network trace: cold load = cover + thumbs; selection = one large request |
| Admin editor: 4 slots, count, cover explanation, replace/remove/set cover/move, choose-existing, multi-upload ≤4, conflict display (§9) | `apps/web/src/pages/admin/products/[id]/media.astro` + `PUT /admin/products/:id/media`, `POST …/media/upload`; `MediaPicker` reuse | route auth test (architecture suite), Playwright admin flow on local stack |
| Completeness queue + reconciliation export (§9) | `GET /admin/media/gallery-queue`, page `admin/media/gallery-queue.astro`, CSV via `csvSafeCell` | unit (filters), architecture (nav links resolve) |
| Reviewed import: stage → plan (hash, revisions) → approve (four eyes) → apply per product with ledger → recovery (§10) | `MediaImportUseCases` + tables `media_import_sessions/rows` (0149) + routes + wizard page | unit (plan statuses, stale bytes/revisions, duplicate slot, slot 5, ambiguous), integration (apply + resume), fixture batch of 180 files under `tests/fixtures/media-import/` |
| Upload safety: decoded format, pixel cap, dangerous names (§11) | pixel cap in `MediaLibraryUseCase.upload` (new), filename sanitiser reuse | unit |
| Audit and observability (§11) | audit row in mutation txn; signals `MISSING_COVER`, `ASSET_NOT_READY` in the queue | unit |
| Analytics event only after commit, none on hydration (§11) | `track('product_gallery_viewed', …)` in controller | unit (event emission count) |
| Feature rollback keeps current Slot 1 (§8, §13) | `PRODUCT_GALLERY_ENRICHMENT=false` path | Playwright: swap cover, disable, assert cover |

## 9. Out of scope, stated

Site-wide rebrand, new recommendations, new checkout, new media infrastructure, invented photography, production deployment, image sitemap, hero-slide re-resolution, the cart's `limit=100` fragility, the SW's unbounded image cache (all recorded as pre-existing).
