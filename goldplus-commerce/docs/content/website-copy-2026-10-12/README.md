# Website copy, SEO and answer-engine handoff V2 — implementation record (2026-10-12)

Source: the owner's `GoldPlus_Claude_Exhaustive_Website_Copy_SEO_AEO_V2_2026-10-12.md`.
Branch `content/website-copy-seo-2026-10-12` on `deploy/price-floor-145k` (`44fb4df5`).
Nothing was published, no price, stock, SKU, URL or policy commitment was changed.

## Before / after by page (code, live on the next web roll)

| Page | Before | After | Handoff item |
|---|---|---|---|
| `/` | title "Premium electronics in Uganda"; description promised same-day delivery | title "Phone Accessories in Kampala, Uganda"; description names the ranges and the battery-by-model path | page plan `/` |
| `/power` | "Power & charging accessories"; intro "Every item ships from real stock"; criteria gave a 1–2 charges rule of thumb | H1 "Power and charging accessories"; intro tells the shopper to choose the connection first; Wh explained, no charge count; a **Phone batteries** tile beside the children | page plan, SEO-04 |
| `/power/power-banks` `/power/chargers` `/power/charging-cables` | titles "X \| GoldPlus Uganda", intros about live stock | page-plan titles, H1s and descriptions; intros say what to check (ports, shared output, both cable ends, 3A ≠ USB 3.0) | page plans |
| `/audio` | "Audio accessories"; criteria claimed over-ear "usually last longer" | "Choose how you listen"; wired/wireless explained; runtime only from each record | page plan |
| `/audio/wireless-earbuds` | listed wired H02, H06, H07 (taxonomy folds them into "earbuds") | `excludeKeywords: ['wired','3.5mm']` on the child; wired sets stay on `/audio` | UX-02 |
| `/audio/headphones` | keyword-gathered, noindex by gate | copy per plan; noindex gate unchanged | page plan |
| `/storage`, children | "Storage devices" | "Storage for compatible devices"; device-support and recording-speed wording; "ask us about the checks available" instead of a testing claim | page plan, OPS-01 |
| `/phone-batteries` | "Phone batteries"; capacity criterion said a replacement should match the rating | "Find the right replacement phone battery"; code + variant first; rated vs typical capacity; do not open a sealed phone | page plan |
| `/computer-accessories` | generic | names the actual range (mouse, USB sound cards) | page plan |
| `/car-accessories` | promised mounts and Bluetooth kits in title, description, intro and a "Mount types" criterion | "USB Car Chargers"; chargers only; per-port rating wording | corrections table, UX |
| Hub delivery FAQ, `/faq`, `/delivery/kampala-wakiso` | "exact fee shown before you pay" | "an estimate is shown at checkout before you pay and confirmed before the rider leaves" (what checkout actually says) | OPS-04 |
| `/faq` | 5 questions; "every unit is tested before it is sold" | title/H1 per plan; testing claim replaced by the verification-code check; four answer-bank questions added (wattage, 3A vs USB 3.0, magnetic power banks, rated vs typical) | OPS-01, answer bank |
| `/blog/<guide>` | title emitted "… \| GoldPlus \| GoldPlus" | the post's meta title is used as given; the layout adds the brand only when missing | SEO-02 |
| `/blog` | "Guides & advice" | "Accessory Buying Guides & Advice"; description per plan | page plan |
| `/support`, `/quote-request`, `/dealers/apply`, `/support/fake`, `/support/issue` | generic or no description | route-specific titles and descriptions per plan | SEO-03 |
| `/verification` | description said each code verifies once | neutral wording; interpretation of a repeat check left to support | OPS-03 |
| `/warranty`, `/returns`, `/locations/zainab-aziza` | fallback titles | titles per plan (CMS values still win where set) | page plans |
| `/support/fake` | location picker said "Where did you find the product?", "Describe where the delivery should go", "confirm the delivery details … before dispatch" | contextual label, helper and free-text label; dispatch note hidden (`manualLabel`, `manualNote` props) | OPS-05 / form review |
| Product page "You may also need" rail | subtitle "Made to work with the one you're looking at." | "Chosen from the compatibility records for this product. Check the fit on each product page before you order." | recommendations |

Product JSON-LD `image`: already emitted for every real photograph and omitted for sample frames (`ProductJsonLd.astro`); the 111 missing images in the audit are products without a real photo, which the photo batches fix, not the schema.

## Guides (docs only; the owner republishes)

`docs/content/guides/01–03` updated: meta titles per plan (brand once), the charger guide no longer says the highest printed line is the "real maximum" and explains port vs shared limits and box-vs-label conflicts, the power-bank guide replaces the 60–70 % rule and the charge-count table with a Wh explanation and refers flyers to the unit's Wh label and the airline, the battery guide adds rated vs typical capacity. Apply on the host as before:

```
ACTOR_USER_ID=<admin uuid> npx tsx src/scripts/publish-guides.ts
```
(the script updates existing posts by slug; the URLs do not change.)

## Product metadata review queue (no import)

`apps/api/src/scripts/data/seo-metadata-review-2026-10-12.json` holds all 183 records from the handoff (167 retain/review-only, 10 identity holds, 6 proposed-copy-requires-field-match). `review-seo-metadata.ts` prints live name and short description beside each candidate and never writes:

```
ONLY=changes npx tsx src/scripts/review-seo-metadata.ts
```

## Unresolved identities and facts (owner decisions, not copy)

From the handoff's register, kept out of every customer surface:
- ID-01 / SPEC-01: GP-C09 vs GP-C10 photo assignment and the 100 W / 45 W / ~20 W output conflict.
- ID-02: GP02BT OWS artwork vs stem earbuds in the case.
- ID-03: GP-H02 is wired on the site, wireless in the photographed box. The wired SKU is preserved.
- ID-04: BL-58BX label vs 51BX sticker.
- ID-05 / ID-06: GP01 ↔ GP-H01 and GP-W5 ↔ PD-W5 / GP-W2 ↔ PD-W2 aliases.
- SPEC-02…09: P02W 5 W wireless (not 15 W), CA02 USB-C ~20 W (not 36 W), L12 66 W vs 20 W, P03A capacity, PD-W5 output, W04/W06 runtimes, storage speeds and card type.
- OPS-01: "every card is written full and read back" is not amplified anywhere until the process is documented.
- OPS-02: warranty durations per SKU (10-year storage badge, 12-month battery badge) are not applied.
- OPS-03: verification repeat-check semantics.
- UX-01: battery finder counts are the finder's own data, untouched here.

## Not done, and why

- Product page modules ("At a glance", "What is included", "Compatibility"): the PDP already renders verified specs and attributes from the record; adding modules without resolved field states would surface the conflicts above. Queue first.
- New guides from the backlog table: the handoff asks for the existing three to be improved first.
- Business Profile and other external profile edits: owner-authorised, outside the repo.
- The shop assistant's delivery sentence (`assistantRouter.ts`, PR #64) gets the same "estimate … confirmed before the rider leaves" wording once #64 is on the deploy branch.

## Checks

Recorded in the pull request description.

## Evening pass (same day): loose ends closed

| Item | What happened | Evidence |
|---|---|---|
| 111 products with only placeholder frames | Set to draft + inactive through the bulk-approval path (PR #68, audit batch `8240d429-3542-43a1-879f-d8c8ab031eb2`); 72 products live | API list 183 → 72; sitemap 183 → 72; hubs recount |
| Trigger bug blocking every price/stock/publish change since 2026-10-06 | Migration 0176 (PR #70) | reproduced before/after on PostgreSQL |
| Guides 01–03 | Republished from the corrected files (updated 3, failed 0) | live titles carry the brand once; "real maximum" and the 60–70 % rule gone |
| 16 metadata candidates | Reviewed; 5 applied (CA02, L12, L03C, M02C, C10) via the product editor's save path (PRs #71, #72) | live titles; disputed specs now "Not confirmed" or per-port |
| Homepage H1 | "Phone accessories, power and audio in Kampala" (was a hidden "verified original electronics" line) | `HeroSlider.astro` |
| Answer-bank on hubs | 23 short, always-true Q&As placed on the range they belong to, plus "Read before you choose" guide links | `categoryHubs.ts`, `CategoryHubEngine.test.ts` |
| Old product URLs | A once-published product that is off sale answers 404 with its name, its range and WhatsApp instead of a blank redirect; never-published products stay a bare 404 | `DrizzleUnlistedProductReader.ts`, `GetProductBySlugUnlisted.test.ts` |

### Still the owner's decision

- **"Every unit is tested before it is sold."** Removed from the FAQ (OPS-01) but still stated in the site banner (`GpNav.astro`), `llms.txt`, the agent documents and most product long descriptions. Either the shop tests every unit and the FAQ should say it again, or it does not and a one-pass script should replace the sentence everywhere with "Ask us about the checks available for this product". Say which.
- **Search Console**: resubmit `sitemap.xml`, request indexing for `/`, `/power`, `/power/chargers`, `/power/charging-cables`, `/power/power-banks`, `/phone-batteries`, `/storage`, `/audio` and the three guides. The 111 drafted URLs will drop from the index on their own.
- **Google Business Profile**: address, hours and phone must match `businessInfo.ts` (Zainab Aziza Building, 4th floor, Burton Street, opposite Pioneer Mall; Mon–Sat 8:30–18:00; 0705 004545).
- Photos for the 111 drafted products; approve each in the admin as it is photographed. GP-H02 (wired vs wireless), C09/C10, GP02BT and the 58BX battery stay held until the identity questions are answered.
