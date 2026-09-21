# Focus 4 — release report (2026-09-21)

**Status: implemented · tested · committed on `focus4/product-gallery` · NOT pushed · NOT deployed · production data unchanged.**

## 1. What was implemented

| Layer | Delivered |
|---|---|
| Data | Migration `0148_product_media_slots` (slot 1–4 with CHECK, partial unique (product, slot) and (product, asset), `products.media_revision`); `0149_media_import_sessions` (import sessions + row ledger). Additive only. |
| Domain | `ProductMediaSlotMap` (all admin mutations, pure), `ProductMediaBackfill` (planner), `MediaImportPlanner` (filename convention, manifests, SKU resolution, statuses, plan hash), shared `resolveGallery` (the one cover rule). |
| Application | `ProductMediaUseCases` (mutate / replaceMap / assignAsCover / assignNextFree / removeImage / undo / history), `MediaImportUseCases` (stage / approve four-eyes / apply with ledger / resume / results). |
| Infrastructure | `DrizzleProductMediaRepository.applySlotMap` — the ONE `product_images` writer: row lock, revision check, readiness re-check, NULL-park then write, projection, usages, audit, one transaction. `DrizzleMediaImportRepository`. Legacy writers routed (upload, delete, media assign, battery evidence, photos-by-code, script) or disabled (add-by-URL → 410). |
| API | `GET/PUT /admin/products/:id/media`, `POST …/media/upload` (≤4 files, slot map, revision), `GET /admin/media/gallery-queue` (+ `reconciliation.csv`), `/admin/media-imports` (list / stage / detail / approval / apply / results.csv). |
| Storefront | `ProductGallery.astro` + `productGalleryState.ts` (SSR cover with srcset/sizes/fetchpriority, thumbs, race-safe controller, focus rules, retry, no-JS links); PDP purchase hierarchy; JSON-LD image array; `PRODUCT_GALLERY_ENRICHMENT` switch. |
| Admin | Gallery editor (`/admin/products/:id/media`), gallery queue, image imports (index + session), nav entries, listing editor link. |
| Tests | 7 new unit files (slot map 18, resolver 6, gallery state 14, backfill 6, planner 9, import use cases 5, upload 4), 1 architecture guard (single cover resolver / single writer), 1 real-PostgreSQL integration file (9), Playwright evidence runner + stub API + fixture generator. Guards realigned: 5 source-text tests, 1 route inventory count. |
| Docs | Discovery, architecture, design, media standard, admin guide, acceptance matrix, this report. |

Tested commit: the last commit on `focus4/product-gallery` (see `git log`); working tree clean after the final commit. Base: `b580b3e5` on `deploy/price-floor-145k` (what production runs, plus docs).

## 2. Verified inventory and remaining gaps (production, read-only, 2026-09-21 08:22 UTC)

192 products (183 active); **29 have one image, none more, 160 active have none**; 26 assets (three shared), all webp, 0 duplicates, 0 unassigned; the owner's 40 local masters are already these assets. **No product has four real frames; every four-image result in this report used clearly labelled TEST FRAME fixtures.** Photography remains the gap: see the shot list in the design document and the media standard.

## 3. Policies

- **Canonical cover** = slot 1. `is_primary`, `display_order`, `products.image_url/has_image` are a projection written in the same transaction; no independent writes remain (architecture guard).
- **Transient selection** never leaves the browser: no request, no cookie, no storage, no analytics event.
- **Historical snapshots**: orders, carts, emails and feeds store no product image today, so nothing is rewritten or preserved; if a snapshot is added later it captures slot 1 at transaction time.

## 4. Migration / backfill / import readiness

- 0148 + 0149 applied by the real runner on a disposable production clone on the host (`integration-on-clone.sh`, image `goldplus-itest:focus4`), constraints asserted. **Not applied to production.**
- Backfill script written, dry-run by default, resumable, conflict-reporting. **Not run against production** (would place the 29 current primaries into slot 1; expected 29 WOULD_ASSIGN_COVER, 0 conflicts — to be confirmed by the dry run).
- Import pipeline unit-tested including a 180-file batch. **No live import performed.**
- Environment where anything was applied: the disposable clone only (destroyed after the run) and a local stub stack.

## 5. Tests, measurements, evidence level

| Suite | Result |
|---|---|
| vitest unit + architecture (clean tree) | 500 files, 8,168 tests, **0 failed** (1 pre-existing environment-only failure `ZeroSkipGate` is not in this set) |
| Real PostgreSQL (clone) | 9/9 |
| Storefront `tsc`, `astro check`, `astro build` | clean |
| Playwright evidence (Chromium) | all hard gates pass; details in the acceptance matrix |

Performance, before → after (local stub stack; production numbers require a deploy):

| Measure | Before (production, 21 Sep) | After (local fixture) |
|---|---|---|
| Add to cart top, 1440×900, GP03BT | 1700 px (below fold) | **675 px (visible)** |
| Add to cart top, 390×844, GP03BT | 2235 px | **1118 px, above the spec table** |
| Cold-load gallery requests | 1 unsized 800×800-declared image, no srcset | cover (`pdp.webp`, srcset+sizes, fetchpriority high) + 3 × 160 px thumbs; no eager secondaries |
| Selection | n/a | exactly one large rendition (the chosen image) + the demoted cover's thumb |
| Gallery JS / CSS | none | 3.9 KiB / ~1.0 KiB gzip |
| Layout shift | image without reserved geometry | reserved square stage; horizontal overflow at 0 of 14 widths |
| LCP / INP / CLS field or 5-run lab medians | not measured in this delivery | **NOT DONE** (needs a deployed build; Lighthouse Watch covers `/` and `/shop` only) |

Browser/device evidence level: Chromium (Playwright) only. Firefox, WebKit, Android Chrome, Samsung Internet, iOS Safari, WebViews, smart TV: **REAL_DEVICE_UNVERIFIED**.

## 6. Curated screenshots

`docs/media/evidence/baseline-2026-09-21/` (before, production) and `docs/media/evidence/focus4-local-2026-09-21/`: `four-390|820|1440|1920-{fold,full}.png`, `one-…`, `four-1440-secondary-active.png`, `four-1440-nojs.png`, `four-1440-thumb-failed.png`, `evidence.json`. Admin editor, queue and import screens: **no screenshots** (no local API/DB to drive them; they render through the same SSR pattern as the listing editor and pass the route-protection and nav-link guards).

## 7. Remaining defects, unavailable evidence, rollout, rollback

Defects found and fixed during evidence capture: (a) keyboard activation stranded focus on `<body>` because the preview row re-appended nodes on every render — fixed by rebuilding the row only when its composition changes; (b) a thumbnail that failed before the controller mounted was never labelled — fixed by detecting the failed/swapped state at mount.

Open, honestly:
- No real four-frame photography exists; pilots are fixtures.
- Admin editor / queue / import pages: build-verified and guard-verified, not walked in a browser.
- No pixel/decompression cap on uploads (pre-existing).
- The recently-viewed rail requests the cover again as a card (pre-existing behaviour, unrelated to the gallery; visible in the trace as `coverImgsOutsideGallery = 1`).
- Firefox/WebKit/real devices, zoom/reflow, screen-reader spot check, five-run performance medians: not done.
- Analytics event for gallery interaction: deliberately not added (shared telemetry vocabulary; out of "picture only" scope).
- Image sitemap, hero-slide re-resolution, cart `limit=100`, unbounded SW image cache: pre-existing, unchanged.

Bounded rollout (when authorised): `migrate-prod.sh` with 0148+0149 (backup → clone rehearsal → live, as the house does) → deploy api+web → `backfill-product-media-slots.ts` dry run → review report → apply → check `/admin/media/gallery-queue` shows every imaged product `migrated` → observe PDP for one hour. Rollback: previous images (`rollback-*` tags); the projection keeps the correct cover; `PRODUCT_GALLERY_ENRICHMENT=false` as the containment switch. Schema stays.

## 7a. Regression proof for the other modules (added after self-review, 2026-09-21)

The entire real-PostgreSQL integration suite (49 files) was run on a disposable production clone with a builder image from this branch: **39 files passed, 7 skipped (provider-gated), 3 failed (5 tests)** — `CustomerRfm` (a count from the backup's real orders), `DeviceCatalogue` AC1/AC3/AC5 (the pre-battery-module compatibility table semantics), `PesapalPaymentJourney` (a test stub lacks `notifyFulfilmentOfPaidOrder`). The same three suites were then run against an image built from the **base commit `b580b3e5`** on a fresh clone: **the identical 5 tests fail there too.** They are pre-existing and unrelated to this branch (none touches product images). Every suite that exercises the readers this branch changed — product public view, merchant feed SQL, battery finder and catalogue SQL, recommendation readers, blog, search — passed on the clone.

Also fixed in self-review: the older product edit page still offered "add image by URL" (now 410) — replaced with a link to the gallery editor and the copy corrected to four files; the 0148 indexes are now declared in the Drizzle schema so a future `db:generate` cannot propose dropping them; the legacy image repository lists canonical slots first.

## 8. Explicit status

implemented ✔ · tested ✔ (unit, architecture, real-PG on a clone, Chromium evidence) · committed ✔ · pushed ✘ · deployed ✘
