# Product media platform (Focus 4)

Status: implemented on branch `focus4/product-gallery`, tested, committed, **not pushed, not deployed**. Companion documents: `docs/media/FOCUS4_DISCOVERY.md` (evidence and decisions), `docs/design/GOLDPLUS_FOCUS4_GALLERY.md` (customer experience), `docs/media/GOLDPLUS_FOCUS4_MEDIA_STANDARD.md`, `docs/media/GOLDPLUS_FOCUS4_ADMIN_GUIDE.md`, `docs/media/FOCUS4_ACCEPTANCE_MATRIX.md`, `docs/media/FOCUS4_RELEASE_REPORT.md`.

## 1. Schema and authority

| Table | Role | Change |
|---|---|---|
| `media_assets` | Immutable asset identity: sha256 checksum (UNIQUE), storage key, dimensions, bytes, `ACTIVE/ARCHIVED` | unchanged |
| `media_asset_variants` | Renditions per asset: `thumb 160 / card 480 / pdp 1024 / zoom 2048` × `avif/webp/jpeg`, generated at upload | unchanged |
| `product_images` | **Assignment**: one row per (product, asset). New in 0148: `slot smallint NULL CHECK 1..4`, `updated_at`; partial UNIQUE `(product_id, slot) WHERE slot IS NOT NULL`; partial UNIQUE `(product_id, asset_id) WHERE asset_id IS NOT NULL AND slot IS NOT NULL` | expanded |
| `products.media_revision` | Optimistic-concurrency revision of the gallery (0148) | new |
| `products.image_url`, `has_image`, `product_images.is_primary`, `display_order` | **One-way projection** of slot 1, written only by the mutation repository. Retained for old readers; removal criteria in §9 | demoted |
| `media_usages` | Reference graph: one `gallery` row per assigned asset, maintained by the mutation repository (added and removed) | now maintained in both directions |
| `media_import_sessions`, `media_import_rows` | Reviewed bulk import: plan, approval, per-product ledger (0149) | new |
| `audit_logs` | Every gallery write: `entity='product_media'`, `entity_id=product`, `previous_state.map`, `new_state.map/revision/action/requestId`, written **inside** the mutation transaction | reused |

**Cover authority.** Slot 1 is the cover. `resolveGallery()` (`packages/shared/src/media/resolveGallery.ts`) is the only row-level rule; `galleryOrderSql()` / `galleryVisibleSql()` (`apps/api/src/infrastructure/db/mediaDisplayUrl.ts`) the only SQL rule. A product with any slotted row shows only its slotted rows, in slot order; a product not yet backfilled falls back to `is_primary DESC, display_order ASC` and reports `migrated: false`. `tests/architecture/single-cover-resolver.test.ts` fails the build if any reader sorts images another way or any file but the mutation repository writes `product_images`.

**Readiness.** An asset may enter a slot only if it is `ACTIVE` and has the storefront rendition (`pdp`/`webp`). Legacy URL-only rows (no asset) can never be slotted; they stay visible through the fallback until re-ingested.

## 2. Request lifecycle

```
admin form POST ──► Astro page (session cookie) ──► API PUT /admin/products/:id/media {expectedRevision, action}
                                                      │
                                                      ▼
                     ProductMediaUseCases.mutate: snapshot → applySlotAction (pure) → validateSlotMap(ready set)
                                                      │
                                                      ▼
   DrizzleProductMediaRepository.applySlotMap (ONE transaction):
     SELECT products … FOR UPDATE            → lock the parent row
     compare media_revision                  → STALE → 409 to the editor, nothing written
     re-check asset readiness                → ASSET_NOT_READY aborts
     UPDATE product_images SET slot = NULL   → park every gallery row (partial indexes ignore NULL)
     DELETE rows leaving the gallery         → asset stays in the library
     UPDATE/INSERT rows for the new map      → slot, is_primary = (slot=1), display_order = slot−1, alt
     UPDATE products image_url/has_image/media_revision+1
     DELETE/INSERT media_usages (field 'gallery')
     INSERT audit_logs (old map, new map, revision, action, request id)
```

Actions: `ASSIGN`, `REPLACE`, `SET_COVER` (swap with slot 1; move into slot 1 if empty), `REMOVE` (secondary: clear only that slot; cover: requires `replacementAssetId`, or `allowClearLastCover` for the explicit draft case), `MOVE` (swap when occupied), `SET_ALT`, `RESTORE` (undo), and `replaceMap` for whole-map writers (import apply, backfill, multi-upload). All are in `apps/api/src/domain/media/ProductMediaSlotMap.ts` and unit-tested.

Legacy writers routed or disabled: `POST /admin/products/:id/images` (URL) → **410 SUPERSEDED**; `POST /admin/products/:id/images/upload` → library + next free slot; `DELETE /admin/products/images/:id` → gallery `REMOVE` (cover needs a replacement) or direct delete for an unslotted legacy row; `MediaLibraryUseCase.assignToProduct` → `assignAsCover`; battery evidence "set as product photo" → `assignToProduct`; photos-by-code apply and `attach-images-by-code.ts` → `assignNextFree`; `DrizzleProductImageRepository.add/setPrimary` throw `SUPERSEDED`.

## 3. Revision concurrency

Every write carries `expectedRevision`. The repository compares it under the row lock and increments on success; a mismatch returns `STALE` and the use case surfaces `STALE_REVISION` with the current revision. The editor renders the revision it was given into every form; a stale submit shows the conflict and re-renders the current slots. Undo is `RESTORE` of the audit entry's `previous_state.map` as a new revision-checked write, so it can never overwrite a colleague's later edit. Real-PostgreSQL proof: `tests/integration/ProductMediaMutation.integration.test.ts` (two writers with one revision; concurrent insertion into an empty gallery).

## 4. Derivatives and delivery

Unchanged pipeline: `MediaLibraryUseCase.upload` sniffs the type from magic bytes, enforces 15 MB, hashes, deduplicates, writes the master and generates renditions synchronously with sharp (never upscaled). The storefront serves `pdp.webp` (1024) on the stage with a `srcset` of `thumb 160w / card 480w / pdp 1024w` and `sizes` sized to the stage; previews load `thumb.webp` (160) only. Large secondaries are requested only on intentional selection, decoded through the same `srcset`/`sizes` so the stage swap issues no second request. The 2048 `zoom` tier is not referenced by the storefront.

## 5. Cache propagation

Rendition URLs are content-addressed (`/uploads/assets/<sha[0:2]>/<sha[0:12]>/…`) and served `immutable` by Caddy; a new image is a new URL. PDP HTML is not cached by Caddy or the service worker. The merchant feed keeps a 15-minute in-process cache: a cover change reaches the feed within 15 minutes. There is no application cache to purge, so no outbox job was added (recorded as decision D5). Third-party social preview caches (WhatsApp, Facebook) refresh on their own schedule; an application cannot force them.

## 6. Imports

`docs/media/GOLDPLUS_FOCUS4_ADMIN_GUIDE.md` §4 for the operator view. Mechanically: `MediaImportUseCases.stage` uploads through the library (a write, labelled as such), resolves SKUs with the catalogue's own token rules (`PhotoCodeMatcher`), builds a deterministic plan (`MediaImportPlanner`, pure) with per-row statuses and a plan hash over importer version, rows and proposed maps; `approve` requires a different actor than the stager and no blocking rows; `apply` runs one `replaceMap` per product, records `APPLIED / SKIPPED / STALE / FAILED / NOT_ATTEMPTED` per product and stops on the first unexpected failure; `resume` continues the remaining products. No batch-wide atomicity is claimed. Idempotent: an applied product is skipped, an unchanged map is `NOTHING_TO_DO`.

## 7. Compatibility and rollout

Expand/backfill/switch. 0148 and 0149 are additive; readers keep working before the backfill through the legacy fallback. `apps/api/src/scripts/backfill-product-media-slots.ts` (dry run by default, resumable by product id, skips any product with `media_revision > 0` or a slotted row, reports conflicts instead of guessing) places each verified current primary into slot 1 only. Rollout order: migrate → deploy → dry-run backfill → review conflicts → apply backfill → measure `migrated: false` usage in the queue. Feature switch `PRODUCT_GALLERY_ENRICHMENT=false` renders slot 1 only with the correct cover.

## 8. Security and resource limits

Uploads: existing magic-byte allow-list (png/jpeg/webp/avif/gif), 15 MB, filenames sanitised into a content-addressed path; import filenames additionally refused if they contain path separators, `..` or control characters; alt text stripped of control characters and capped at 255. CSV exports go through `csvCell` (formula-injection safe). Permissions reused: `PRODUCTS_READ/WRITE` for the editor, `MEDIA_READ/MANAGE` for the queue and imports; four-eyes by actor identity. The queue reads one aggregate query; no per-asset HEAD requests. Import batches are capped at 250 files per session; rendition generation remains synchronous per file (pre-existing; not moved into commerce requests). **Not added:** a pixel/decompression cap in the library (pre-existing gap, recorded in the release report).

## 9. Legacy column removal criteria

`is_primary`, `display_order` and `products.image_url` may be dropped only when: every product with images is `migrated: true` in the queue for 30 days; no reader references them (the architecture guard already forbids sorting by them); the merchant feed, battery finder and product finder have been observed serving slot data; and a backup with the columns exists off-host. None of this is scheduled.

## 10. Non-destructive rollback

Code rollback to the previous images leaves the new columns and tables in place; old readers ignore `slot` and read `is_primary/display_order`, which the mutation service has kept in sync as a projection, so the current cover remains correct after any number of gallery edits. Reverting to stale legacy cover data cannot happen because the projection is written in the same transaction as the slots.
