# Organic growth programme — search and content for shopgoldplus.com

Owner: the business owner. Maintained by whoever runs the programme. Four files only:
`README.md` (this: strategy, policies, measurement, gates, roadmap), `evidence-register.md`, `query-page-map.md` (with page briefs and the video brief), `research-2026-10-28.md` (raw findings), plus `progress.md` (what shipped, what is blocked).
Started 2026-10-28. Governed by CLAUDE.md (no invented facts, reviews, ratings or scarcity; dealer/supplier prices never public) and `docs/customer-language-standard.md`.

## 1. Strategy sentence

**For a Ugandan phone owner whose battery is failing, we will become the most useful source for the decision "which replacement battery fits my exact phone, and how do I know before I pay", by answering it per phone with the pack code, the price, the provenance of the fit and a way to confirm it, and by being honest when we do not have the battery — ahead of forum threads, foreign listings and sellers who do not sell batteries.**

## 2. The decision (section B of the brief)

### 2.1 Initial cluster: device-specific phone-battery compatibility and replacement confidence
Why this one, with the evidence (register rows in brackets):
- The buying queries have no Ugandan answer: four compatibility queries returned zero Ugandan sellers; the gap is filled by iFixit forums, Kenyan shops and Flipkart [25]. The best-visible Ugandan retailer (KWT Tech Mart) ranks for battery problems and sells no batteries [26].
- GoldPlus already owns the hard part: a finder with 204 phones, 13 live batteries, a compatibility workflow with provenance, and 20+ published battery guides [7, 8, 14]. The missing piece was plumbing, not content: no indexable per-phone URL, the hub not linked to the finder, no funnel events, Clarity blind [10, 11, 12, 20].
- It is defensible: the edge is fit certainty and provenance, which price-leader Oraimo does not offer and resellers on Jiji actively muddy [27, 28].
- The strongest argument against: only ~22 phones currently resolve to a purchasable battery and all fits are supplier-listed, so the cluster's surface is ~22 pages until ops publishes more batteries and verifies fits [7, 8]; and demand is unmeasured until `demand-export.sh` runs [31]. The pilot is built so that every new approved battery or claim creates its page automatically; the gate at 30 days decides whether to widen.

### 2.2 Subsequent cluster: power banks with measured watt-hours
GoldPlus's 45 power-and-charging products are its largest range, but every competitor states the same manufacturer numbers and Oraimo undercuts on price [27]. The only edge that is not price is measured Wh delivered [30], which needs a meter and a protocol first. Nothing is published until a measurement exists.

### 2.3 Deferred, with the reason
| Idea | Why not now |
|---|---|
| "<category> price in Uganda" landing pages | Ranks for others on thin pages, but GoldPlus has one brand: a price table is a product list. Revisit when the catalogue has comparable alternatives or the hub gains a price-sorted view. |
| GoldPlus vs Oraimo comparison | "GoldPlus" resolves to Titan jewellery in generic search [29]; disambiguation first. |
| Recorded call samples for earbuds | Needs recording kit and a protocol; smaller range (10 products). |
| Wholesale/B2B SEO | No observable demand signal; bulk buying already exists behind a phone gate. |
| Jumia/Kilimall storefronts | Neither ranked for a product query; Jiji did, and hosts unauthorised GoldPlus listings — that is an ops hygiene task, not a growth page. |
| Jiji brand hygiene | Ops: contact resellers, check capacity claims. Not a website change. |

## 3. What the pilot built (section D) — see `progress.md` for file-level detail
1. **Per-phone pages** `/phone-batteries/<device-slug>`: indexable while ≥1 battery can be bought; noindex otherwise; 503 fail-closed when the finder is unreachable. Facts from the finder at render time.
2. **Fit index** `GET /batteries/finder/fit-index`: every phone with a battery, by brand. Feeds the hub's new "Batteries by phone" section, the sitemap and the per-phone pages' sibling links, so the three can never disagree.
3. **Finder**: device links go to the per-phone page; `?device=` canonicalises to it; a typed query fires GA4 `search`.
4. **Battery PDP template**: Q&A heading fixed; fit list links to per-phone pages; provenance wording matches the data; guide chips; JSON-LD gains pack code, mAh/V when recorded, `isAccessoryOrSparePartFor`; ADDED_TO_CART beacon.
5. **Hub**: finder tile; per-phone list.
6. **Measurement**: finder funnel events now sent (RESULT_VIEWED, PRODUCT_VIEWED, ADDED_TO_CART) through a same-origin relay; Clarity allowlist fixed; GA4 `search` on the finder.
7. **Copy honesty**: the unbacked "fit confirmed before you pay" promise reworded to a service offer on FAQ, llms.txt, agent tools/skill/documents, /developers and four guides; OPERATING.md brought in line with the 0211 policy.
8. **Blog**: Article JSON-LD image fallback; battery guides' CTA → finder.
9. **Video brief** (query-page-map.md §2.8), not recorded.

## 4. Technical SEO URL policy by page type

| Page type | URL | Index | Canonical | Sitemap | Notes |
|---|---|---|---|---|---|
| Per-phone battery page | `/phone-batteries/<device-slug>` (lowercase kebab, finder's slug) | index while ≥1 public fit; else `noindex,follow` | self | hubs.xml, only while indexable | Unknown/malformed slug → 404. Finder down → 503 + noindex. |
| Finder | `/battery-finder` | index when ≥5 fits (existing rule); any `?q= ?brand= ?device=` → `noindex,follow` | bare page; `?device=` → the per-phone page | hubs.xml when indexable | Form stays GET so a shared result URL still works. |
| Hub | `/phone-batteries`, `/power/...` | index when the release gate passes | self | hubs.xml | Unchanged. Trailing-slash 200 duplicate noted (research B §3), not fixed here. |
| Product | `/products/<slug>` | index (lifecycle rules) | self; `?device=` stripped by canonical | products.xml | `?device=` only sets the "buying for" box and the cookie. |
| Guides | `/blog/<slug>` | index | self | blog.xml | Article JSON-LD always has an image now. |
| Relay | `/api/battery-finder/event` | never (robots disallows `/api/`) | — | — | POST only, 1 KB cap, no personal data. |

Rules: no new query-string landing pages; one URL per phone; a page is removed from search by data (no fit) not by hand; no `lastmod` where there is no honest timestamp.

## 5. Claim policy

Every statement about a product on a public page is one of:
| Label | Meaning | How it appears |
|---|---|---|
| **Manufacturer-stated** | From the pack or the supplier's sheet | Spec tiles; "listed by our supplier" fit label |
| **Measured by GoldPlus** | A recorded measurement with method and date | Not yet used anywhere; required for cluster 2 |
| **Independently sourced** | A named third party with a link | Guides only, with the source named |
| **Estimated** | — | Never on a public page |

Fits: "checked by GoldPlus" only for PACKAGE_VERIFIED / FIT_TESTED / VERIFIED_EXACT / CONDITIONAL claims; "listed by our supplier" for SUPPLIER_LISTED. Capacity and voltage appear only when the record holds them. "Original", "genuine <brand>", "OEM", stock depth and arrival times are banned. Unresolved policy conflicts (register #13, #32) are stated as service offers, never guarantees. Dispatch ("goes out on that day's run") is never written as arrival.

## 6. AEO platform matrix (how assistants reach us)

| Platform / surface | Retrieval | Understanding | Citation | Action | Our control |
|---|---|---|---|---|---|
| Google Search / AI Overviews | Sitemaps, robots allow, Content-Signal search=yes | Product + Offer + `isAccessoryOrSparePartFor`, Breadcrumb, Article | Page title/URL | Buy on site | Live; GSC connection unknown [19] |
| ChatGPT / Perplexity / Claude browsing | robots allows named bots; llms.txt, llms-full.txt, Markdown alternate | Same structured data; llms.txt now explains provenance labels and the per-phone URL pattern | Domain in sources (tracked by the AI-visibility module as a separate measure from mentions) | Read-only | Live |
| MCP / OpenAPI clients | `/mcp`, `/openapi.json` (now lists fit-index), `/.well-known/api-catalog`, agent skill | Tool descriptions reworded (no "only checked fits") | n/a | Read-only by design | Live |
| WhatsApp (human + Goldie) | wa.me prefill from every phone page | Staff answer; Goldie routes battery intent to the finder | — | Confirm fit, then order | Owner confirms practice [32] |
| Meta/TikTok/YouTube | Paid/organic placements measured by MMM | — | — | Landing on per-phone pages | Not in pilot |

## 7. Measurement plan

**Business layer** (source of truth: orders table; weekly read): battery orders, battery revenue, battery share of orders, return rate on batteries by reason. Read with `demand-export.sh` sections and the admin demand page; nothing new to build.

**Journey layer** (finder funnel, `battery_finder_events`): `SEARCH` (existing) → `DEVICE_SELECTED` (existing, finder clicks) → `RESULT_VIEWED` (new: per-phone page view, outcome = first fit state or NO_RESULT) → `PRODUCT_VIEWED` (new: "View and buy") → `ADDED_TO_CART` (new: PDP form submit for a battery, with the chosen phone). Visible in `/admin/batteries/demand` once live. Plus `battery_requests` for unmet demand.

**Discovery layer** (GA4 via sGTM, nightly into `measurement.ga4_daily_series`): landing pages under `/phone-batteries/*`, channel, device; `search` events from the finder (term = phone or code typed); Clarity recordings on hubs/finder/phone pages (unmasked routes). Search Console: impressions/clicks by page once the connection is confirmed.

**Limitations:** GA4 is a session proxy, not a count of people; server-side hits without a session are not sessions (ATTRIBUTION.md); the finder session cookie is per device; Clarity samples; Search Console lags 2–3 days and is not yet confirmed connected; US-located search sampling cannot show Ugandan SERPs. No baseline exists for per-phone pages because the URLs did not exist; the baseline is week 1 after deploy.

## 8. Gates (section F): expand only when all pass

| Gate | Measure | Pass | Read where | Reviewed |
|---|---|---|---|---|
| G1 Indexed | ≥80% of indexable per-phone pages indexed | GSC page indexing | /admin/seo or GSC | Day 30 |
| G2 Honest | 0 public claims outside the claim policy | Spot-check 5 pages + `PhoneBatteryPages.test.ts` green | PR CI | Every deploy |
| G3 Funnel alive | RESULT_VIEWED, PRODUCT_VIEWED and ADDED_TO_CART all non-zero in the demand report | `/admin/batteries/demand` | — | Day 14 |
| G4 Demand known | demand-export.sh run and read; top 10 no-result phones listed | Owner | — | Before any new content |
| G5 Commercial | ≥1 battery order whose session touched a per-phone page (journey layer join) | SQL over orders + finder events | — | Day 30 |
| G6 Ops supply | ≥10 more phones with a purchasable battery (drafts published, claims activated) | fit-index deviceCount | API | Day 30 |
| G7 Practice confirmed | Owner confirms staff confirm fits on WhatsApp before orders | Owner | — | Before deploy, ideally |

## 9. 30 / 60 / 90

- **Day 0–30:** deploy pilot; run demand export; owner answers #32; ops publishes photo-less battery drafts with real photos and enters mAh/V from labels (register #9); confirm Search Console; read G3 at day 14; add the Tecno Spark 10 and the top no-result phones to the device list if the export confirms them.
- **Day 31–60 (if G1–G5 pass):** first verified fits (two-person check) so some pages can say "checked by GoldPlus"; guide 01 gains the provenance explainer; record the 60-second video; buy a USB power meter and write the Wh protocol for cluster 2.
- **Day 61–90:** measured Wh on three power-bank SKUs → cluster 2 pages; brand disambiguation ("GoldPlus Uganda") in Organization markup and copy; decide on Jiji hygiene outreach.

## 10. Self-critique

**As the owner:** 22 pages is small; the real constraint is batteries on the shelf and claims verified, and that is my team's work, not the website's. The pilot is worth deploying only because it is cheap to maintain (pages make themselves) and it stops us promising a guarantee we never built. I still have to run the export and answer whether staff really confirm fits.
**As a sceptical SEO:** these pages are thin by word count and all say "listed by our supplier". Google may index them and show nothing. The counter is that the queries have no Ugandan answer at all today, the pages are the only ones with a UGX price and a model number, and we will know by G1/G5 rather than argue. The US-located search sample is weak evidence and is labelled as such.
**As the customer:** I want to know it fits and what it costs. The page tells me the code, the price, that the fit comes from a supplier list, and how to ask. What it cannot tell me yet is the capacity, because nobody has typed it from the pack. That gap is the first ops task.

## 11. Decision summary

Build per-phone battery pages fed by the finder; fix the plumbing (hub link, funnel events, Clarity, search event, JSON-LD); reword the unbacked promise. Power banks next, only with measurements. Everything else deferred with a stated reason. Expansion gated on indexing, an alive funnel, measured demand, one attributable order, more supply, and the owner's confirmation of the WhatsApp practice.
