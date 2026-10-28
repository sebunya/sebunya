# Organic growth programme — progress

## 2026-10-28 — pilot built (branch `feat/organic-pilot-batteries`, PR to `deploy/price-floor-145k`)

No migration. API + web deploy.

### API
- **Fix found while rendering:** `GET /batteries/products/:slug` returned 404 for every battery whose record is not ACTIVE, even when its supplier-listed fits are live (the finder already shows them). Every live battery is in that state, so every battery PDP in production had lost its "Phones this battery fits" block, the "buying for your phone" box and the fit badges. The route now hides a battery only when it is unpublished *and* has no public fit, which is the finder's own rule.
- `GET /batteries/finder/fit-index` → `FinderFitIndexDto` (brands → devices with ≥1 public fit). `IBatteryFinderRepository.devicesWithPublicFits`, Drizzle implementation (same VERIFIED_PUBLIC / AWAITING_PUBLIC predicates as results), `BatteryFinderUseCases.fitIndex()` honouring the awaiting switch. 120 s public cache.

### Web
- New `pages/phone-batteries/[device].astro` + pure rules in `lib/phoneBatteryPage.ts` (path, slug check, indexability, title/h1/description, guide picker, ItemList JSON-LD).
- New relay `pages/api/battery-finder/event.ts` + browser helper `lib/finderEvents.ts`; beacons on the phone page (RESULT_VIEWED, PRODUCT_VIEWED) and PDP (ADDED_TO_CART).
- `battery-finder.astro`: device links → per-phone pages; `?device=` canonical → per-phone page.
- `[hub]/[...child].astro` + `categoryHubs.ts`: finder tile; "Batteries by phone" from the fit index.
- `products/[slug].astro` + `ProductJsonLd.astro`: Q&A heading; provenance wording; links; guide chips; battery JSON-LD props; tracking attributes.
- `sitemaps/hubs.xml.ts`: per-phone pages from the fit index; `/battery-finder` when indexable.
- `BaseLayout.astro`: Clarity allowlist by real route names.
- `siteSignalRules.ts`: `search` event on `/battery-finder?q=`.
- `blog/[slug].astro`: Article image fallback; battery guides' CTA → finder.
- Copy: `faq.astro`, `llms.txt.ts`, `agentTools.ts`, `agentSkill.ts`, `agentDocuments.ts`, `developers.astro`, `openapi.json.ts` (fit-index listed).
- `lib/batteries.ts`: `PublicResult` carries the upstream status so a 404 phone is a 404 page.

### Docs
- `docs/growth/*` (this programme); `docs/batteries/OPERATING.md` (0211 policy, per-phone pages, price floor wording); guides 11, 14, 15, 23 (promise → service offer; republish via `publish-guides.ts`).

### Tests
- New `tests/unit/PhoneBatteryPages.test.ts` (12); `SiteSignals.test.ts` +1. Ran one file at a time on the owner's Mac (8 GB, 1.6 GB disk free): 24 related files green. API `tsc --noEmit` clean.

### Verified by rendering (dev server, Node 22, against the live API)
- See the PR description for the render evidence. While the live API was unreachable from the Mac the page returned 503 + `noindex,follow` + honest message (the fail-closed branch).

### Blocked / owner
- Run `demand-export.sh` (register #31) — changes cluster confidence and the device list.
- Confirm staff confirm fits on WhatsApp before orders (register #32) — the reworded offer depends on it.
- Publish photo-less battery drafts with photos; enter mAh/V from labels (register #9); more phones → more pages.
- Confirm Search Console connection in `/admin/seo/integrations` (register #19).
- Republish guides 11/14/15/23 (deploy block includes the guides step).
- Decide on the video recording (brief in query-page-map.md §2.8).

### Not done on purpose
- No FAQPage markup (not shown for shops since 2023). No cluster-2 pages (no measurements). No "price in Uganda" pages. No recurring jobs added. Nothing published externally.
