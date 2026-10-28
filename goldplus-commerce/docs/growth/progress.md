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

### Self-review round (same day)
- Relay forwards the customer's address (`apiHeaders`/`readClientAddress`, as the other relays do) so the API's per-address limits and session hashing stay per person; drops known crawler user agents; browser helper skips automated browsers.
- Per-phone canonical uses the device's own slug; meta descriptions say "same-day dispatch", never "delivery"; hologram wording conditional ("if your pack carries a code"); 14-day return stated with its condition (unused, in packaging).
- CI: three pinned tests updated to the new rules (OpenAPI path list now includes fit-index; battery route rule; blog regex rewritten so the frontmatter scanner does not read `batter(` as a call).

### Self-review round 3 (same day) — pre-existing bugs found while proving the pilot
- **Finder sessions were always empty** (register #34): the finder page and the relay read cookie names nothing sets. Now `finderSessionId(locals)` = the signed visit locator; the relay records nothing without it (crawlers that keep no cookies), so the funnel is both joinable and cleaner.
- **Guides republish** (register #35): `publish-guides.ts` skips a guide whose stored content already matches (`GuideFile.guideChanged`, same normalisation as a save) and keeps a cover image set in the editor. This deploy now moves `dateModified` on the 4 edited guides only.
- **Cart overclaim** (register #36): "has been checked against this phone" now distinguishes our check from the supplier's list; link → the phone's page.
- Fit-index brand name from the brand table; phone page finds sibling phones by membership, not by name.
- Battery JSON-LD built by a tested pure function (`batteryProductJsonLdProps`); the PDP guide chips use the device's brand, not the first word of its label.
- New real-PostgreSQL test `tests/integration/BatteryFitIndex.integration.test.ts` (runs in CI's integration job): proves the fit-index SQL against verified, listed, rejected, draft, unapproved and archived cases.

### Self-review round 4 (same day)
- CI's real-PostgreSQL run caught the fit-index seed breaking `battery_profiles_active_published_chk` (an ACTIVE record must name its publisher); seed fixed after checking every constraint on the four tables it writes.
- Gate G5 rewritten: an order cannot be joined to a finder session (the session is a salted one-way hash and orders never carry it), so G5 now reads GA4 purchases by landing page (`measurement.ga4_daily_series`). Gates table now has measurable pass conditions; queries in `funnel-check.sql`.
- `demand-export.sh` (owner-run) checked column by column against the schema: all columns exist.
- Deploy smoke section made non-fatal (`set +e`): a zero is reported, not a failed deploy.

### Tests
- New `tests/unit/PhoneBatteryPages.test.ts` (19); `BlogGuidesPublishable` +3; `SiteSignals.test.ts` +1; `AgentReadiness`, `AuditMediumFindings` updated. Ran one file at a time on the owner's Mac (8 GB, 1.6 GB disk free): 24 related files green. API `tsc --noEmit` clean.

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
