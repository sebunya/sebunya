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

## 7b. Admin API end to end on a real database (second self-review, 2026-09-21)

`tests/integration/ProductMediaAdminApi.integration.test.ts` drives the **real Hono app with the real Registry, real media library and sharp**, only authentication stubbed (the bearer token names the actor, so two different people act), on a disposable production clone: gallery read → multi-upload with a slot map (a fifth file refused) → set cover → stale editor 409 with the current revision → undo → cover removal refused / secondary removed → completeness queue and formula-safe reconciliation CSV → bulk import: blocked plan refused, self-approval 403, second person approves, apply, results CSV, re-apply refused → legacy add-by-URL 410, legacy delete routed through the gallery → **backfill dry run over the whole production copy**.

The first run found a real defect: readiness required the 1024 px `pdp` rendition, and the generator never upscales, so **every valid original narrower than 1024 px was refused** as "not ready" — the false rejection of smaller legacy assets the brief forbids. Fixed: ready = ACTIVE and (display rendition exists OR original width ≤ 1024). Also fixed: a malformed image id on the legacy delete route produced a 500 (now 404). Rerun on a fresh clone: **17/17** (admin API 8, mutation 9). Backfill dry run over the whole production copy: **29 × ASSIGN_COVER, 0 conflicts** — the 29 current primaries would each become slot 1, nothing else invented. Enrichment-off render captured locally (`evidence/focus4-local-2026-09-21/enrichment-off.txt`): gallery marked off, zero previews, zero controls, cover served with `fetchpriority=high`, `og:image` = slot 1.

## 9. DEPLOYED to production — 2026-09-21/22 (owner: "git push and deploy, don't hold back")

| Step | Result |
|---|---|
| Push | `deploy/price-floor-145k` fast-forwarded `b580b3e5 → 1ee11c58` (the Focus 4 branch, 13 commits) |
| Migrator image | `goldplus-migrator:1ee11c58` built on the host (Steward admitted; its "a migration is running" DEFER was a `pgrep` false positive on the wrapper shell's own command line — the build proceeded) |
| `migrate-prod.sh … focus4-0148-0149` | backup `goldplus-prod-pre-focus4-0148-0149-20260921-141706.dump` (158 MB) → ephemeral clone restored (367 tables = live) → migrator run twice → **REHEARSE_OK** → live → assertion 1 (slot column, partial unique index, both import tables) |
| `deploy-prod.sh 1ee11c58 api web` | rolled; the SSH session dropped after the roll, verified afterwards: 4/4 healthy on the new images, `rollback-1ee11c58` and `rollback-pre-1ee11c58` tags present, lock free, checkout at 1ee11c58, gallery markup present in the running web image |
| Backfill dry run (production, media volume mounted) | scanned 29 · would assign 29 · conflicts 0 |
| Backfill apply | **APPLIED: 29 assigned, 0 conflicts, 0 stale, 0 failed**; live DB: 29 products `media_revision > 0`, 29 covers, 0 legacy rows, 29 audit rows, 29 gallery usages, 0 products with `has_image` but no cover |
| Live, real Chromium (probe cookie) | GP03BT: gallery mounted, cover `pdp.webp` with `srcset`/`sizes`/`fetchpriority=high`, JSON-LD image absolute, `og:image` = slot 1, no horizontal overflow at 1440 or 390; GP-C08 likewise; `/shop` and `/` show 10 and 13 cover images, **0 broken** |
| Purchase action on the real GP03BT | 1440×900: Add to cart top **929 px** (baseline 1700) — a content-driven exception: the real title is 78 characters and the summary is two lines, so the action sits just under the 900 px fold on desktop; 390×844: **1226 px**, above the spec table at 1623 (baseline 2235) |
| API errors since the roll | only the pre-existing Lighthouse shortfall reports; 0 × 5xx |

Screenshots: `evidence/focus4-local-2026-09-21/live-1440-fold.png`, `live-390-fold.png`.

Rollback if needed: `rollback-pre-1ee11c58` images for api and web (the projection keeps the covers correct on the old code); schema objects stay; `PRODUCT_GALLERY_ENRICHMENT=false` as the containment switch.

## 10. Demo frames across the site (owner decision, 2026-09-22)

The owner asked for four images on every product now, using the same photo as a visible demo, so the gallery is seen site-wide before real photography arrives. Done with `apps/api/src/scripts/demo-gallery-frames.ts`: for every active product with a cover, slots 2–4 hold that product's OWN cover photo with a small corner mark ("SAMPLE 2/3/4" with pips, font-independent), each a distinct asset, alt text "Sample view (same photo as the cover, placeholder until real photos) — <SKU> frame n", assigned through the audited gallery service. Result: **23 products at 4/4, 69 sample assets, 0 orphans** (a first run had produced byte-identical frames — the container has no fonts, so the text rendered empty and the library deduplicated them; fixed with pips, and the 33 unreferenced assets pruned). The 160 active products with no image at all stay at 0/4. Removal in one command: `MODE=remove` (matches the alt marker; real photos replace a slot through the editor at any time).

Live, real Chromium: GP03BT shows `1 / 4`, three previews, finite arrows, JSON-LD with 4 images; selecting the third commits `3 / 4`. A screenshot taken mid-transition showed a transient retry line and a not-yet-loaded preview; both hardened (state-driven retry line only; eagerly loaded inserted previews) and rolled as a web-only deploy.

Known trade-off, stated: the merchant feed now emits the sample frames as `additional_image_link`; Google may flag text overlays on additional images. Replace with real photos or run `MODE=remove` before a Merchant Center review.

## 11. Self-review after the demo frames (2026-09-22) — three real defects fixed, live at 6689a34f

Looking at the live screenshots rather than the DOM checks exposed what the checks had missed:
1. **The retry line showed permanently.** `[data-gallery-error hidden]` was hidden as an attribute, but the component's `display: flex` rule outranked the user-agent `[hidden]` style (Tailwind's preflight is off in this app). The arrows were affected the same way in the no-JS state. Fix: an explicit `.gp-gallery [hidden] { display: none !important }`.
2. **A runtime-created preview rendered at full size.** Astro scopes component styles with a data attribute that nodes created by the controller never receive, so the demoted cover's preview had no styling. Fix: the gallery stylesheet is `is:global` under its own namespace.
3. **The gallery was below the fold on a laptop.** A square stage at 56 % width put the previews and arrows at 930 px+. Fix: on ≥1024 px the previews form a vertical rail beside a stage capped at `min(72vh, 640px)`; measured live at 1440×900: previews from 273 px, controls at 836 px — all inside the first screen. Mobile keeps the row under the stage (controls 554 px, previews 610 px).
4. **Demo frames were four identical pictures.** Replaced with three distinct views derived from the same real photo (centre detail at 1.6×, lower-right close-up at 2×, full), each marked with a corner badge; the first fill's identical frames were removed (69 assets pruned) and refilled: 23 products, 69 frames, 0 failures. A first replacement attempt ran the remove as a fill because `MODE` was set on the host shell instead of `-e MODE` in the container — corrected. The badge text needs a font the ops container lacks, so the badge shows the pips only; the alt text carries the words.

## 12. Whole-site demo and design pass (2026-09-22, live at 2afc243c + frames from 7d-series script)

Owner feedback: the extra frames "look out of place and feel zoomed in", and the demo had not reached the 160 products without a photo.

- **Frames are gentle variations of the whole photo, not crops**: slot 2 = the object a little closer (the content box at 1.12×, square, so a flash drive stays a flash drive), slot 3 = the same photo at 84 % on a soft studio backdrop, slot 4 = the photo as it is. Badges read "SAMPLE DETAIL / STUDIO / FULL", drawn from a built-in 5×7 glyph set (no font dependency). Regenerated on the 23 photographed products (69 frames, 0 failures).
- **Every product now has four frames**: the 160 photo-less products received a labelled placeholder set (a branded card reading "SAMPLE IMAGE · REAL PHOTO COMING · <SKU>", four tinted variants) — 640 frames, 0 failures. `MODE=remove` leaves these unless `REMOVE_PLACEHOLDERS=1`.
- **Google is protected**: the merchant feed treats any frame whose alt starts with "Sample " as absent and a migrated product with only sample frames as "no image" — verified on the live feed: 23 items, 0 sample references, 0 additional images.
- **Design**: arrows are quiet overlays at the stage edges (fade in on hover on pointer devices, always visible on touch, hidden at the ends), the counter is a small pill inside the stage, the stage is a flat white card with less padding, previews sit in a rail beside it on desktop; the controls row that pushed the page down is gone. Delivery information moved below the buying actions, which now sit inside the first screen on a laptop.
- Verified live from the host through the public route (the workstation's own connection was refusing Cloudflare at that moment): placeholder page, flash-drive page and GP03BT page each render `1 / 4`, three previews and the overlay arrows; api and web 4/4 healthy at 2afc243c; host disk 51 % after 640 new assets and rollback images.

Trade-offs, stated: placeholder covers now appear on product cards, in search and in recommendation rails for the 160 photo-less products (the owner asked for the demo across the entire site); they are visibly labelled and one command removes them. The JSON-LD `image` arrays on those pages contain placeholder URLs until real photos replace them.

## 8. Explicit status

implemented ✔ · tested ✔ (unit, architecture, real-PG on a clone, Chromium evidence) · committed ✔ · pushed ✔ · **deployed ✔ (migrations 0148–0149 live, api+web at 1ee11c58, backfill applied)**

## 13. Final submission pass (2026-09-22, live at 9f555380)

- **Badge**: the "SAMPLE" marker was a banner across the product; it is now ~18 % of the frame width, white on 55 % black, a marker rather than a label. All 709 frames regenerated (183 products, 0 failures).
- **Samples cannot pose as the product anywhere**: already excluded from the merchant feed; now also excluded from `og:image`/`twitter:image` (the page hands the layout its first REAL photo) and from Product structured data — a product whose only images are samples emits **no** `image` at all, rather than a placeholder. Verified live: the flash drive exposes 1 real image and its own `og:image`; the photo-less earphone page exposes 0 and the site default.
- **Operator documentation**: `GOLDPLUS_FOCUS4_ADMIN_GUIDE.md` §4a explains what the samples are, that a real upload replaces one sample and nothing else, and the exact command to retire them (with and without the placeholder sets).
- **Host hygiene**: old migrator images pruned each run; disk 54 % → 50 %.
- Full suites on the clean tree: 500 files / 8,168 tests, 0 failures. api + web 4/4 healthy, `rollback-9f555380` tagged.
