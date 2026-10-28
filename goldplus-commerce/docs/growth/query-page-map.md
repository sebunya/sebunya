# Query-to-page map and page briefs — cluster 1: phone-battery compatibility

Companion to README.md. One row per query shape; one page per intent; nothing here is a traffic estimate.
Queries are written as a Ugandan buyer types them (observed phrasing from the finder's own no-result log once the demand export runs; until then from the search sample in research-2026-10-28.md Part A).

## 1. Query → page

| Query shape (examples) | Intent | Page that answers it | Page type | Why this page and not another |
|---|---|---|---|---|
| `<phone> battery`, `<phone> battery replacement`, `<phone> battery price Kampala/Uganda`, `battery for <phone>` (Tecno Spark 7, Infinix Hot 10, iPhone 13…) | Buy, for a named phone | `/phone-batteries/<device-slug>` | Per-phone page (new) | The only URL that names the phone, shows the packs that fit it with price and provenance, and is indexable. The finder's `?device=` view canonicalises here. |
| `<battery code> battery` (BL-49FT, BL-39LT, IP 13) | Buy, knows the code | `/products/<battery-slug>` | Product page | The code is the product; the PDP now carries the code as mpn, the phones it fits as `isAccessoryOrSparePartFor`, and links to each phone's page. |
| `phone battery Kampala`, `replacement phone batteries Uganda`, `where to buy phone battery Kampala` | Buy, phone not named | `/phone-batteries` | Hub | Lists every pack and, new, every phone with a battery by brand; links the finder for anyone whose phone is missing. |
| `which battery fits my phone`, `find battery by phone model` | Tool | `/battery-finder` | Finder | Indexable only when ≥5 fits exist (unchanged rule); otherwise the hub carries the intent. |
| `how to know which battery fits`, `battery code meaning`, `BL code Tecno` | Learn before buying | `/blog/how-to-find-the-right-replacement-battery-for-your-phone`, `/blog/tecno-battery-codes-bl-explained`, `/blog/finding-the-right-battery-for-infinix-and-itel-phones`, `/blog/how-to-read-the-code-and-ratings-on-a-phone-battery-label` | Guides (existing) | Already published; now linked from every per-phone page and battery PDP, and their CTA goes to the finder. |
| `swollen battery what to do`, `phone battery bulging` | Problem, safety | `/blog/a-swollen-phone-battery-what-to-do-safety-first` | Guide (existing) | Linked from every per-phone page ("Read before you choose"). |
| `original vs replacement battery`, `is GoldPlus battery original` | Trust | `/blog/original-vs-replacement-phone-batteries-what-actually-differs` + per-phone FAQ "Is this an original <brand> battery?" | Guide + on-page FAQ | The honest answer (no, GoldPlus-branded replacement) is on the page a buyer lands on, not only in a guide. |
| `GoldPlus battery warranty`, `return battery wrong fit` | Post-purchase | `/returns`, `/warranty`, per-phone "Buying from GoldPlus" block | Policy pages (existing) | 14-day change of mind covers a wrong fit when the customer did not ask first; stated on the page. |
| `<phone> battery` where the phone has no battery in the catalogue | Buy, unmet | `/phone-batteries/<slug>` (noindex) → request form, WhatsApp | Per-phone page, hidden | The page exists for the finder's links and the cookie but is not offered to search engines: nothing to sell. Demand is recorded (RESULT_VIEWED / NO_RESULT, battery_requests). |

Deliberately no page: "<phone> battery price in Uganda" comparison tables across brands (we have one brand), "GoldPlus vs Oraimo" (brand collision, see register #29), wholesale battery pages.

## 2. Page briefs

Each brief lists the "better than the alternatives" dimensions against what the research found ranking: iFixit forum threads, Kenyan odoo shops, Flipkart/Walmart listings, KWT Tech Mart's problem articles, Jiji ads.

### 2.1 Per-phone page `/phone-batteries/<device-slug>` (built)
- **Answers:** which GoldPlus battery fits this exact phone, what it costs today, whether it is in stock, where the fit claim comes from, how to be sure, how to get it.
- **Source of every fact:** the finder's `/finder/devices/:slug` answer at render time. No hand-written facts per phone.
- **Better than alternatives:** (1) names the pack code *and* the phone's model number, which forum answers tell the buyer to go and find themselves; (2) states provenance per fit ("checked by GoldPlus" vs "listed by our supplier"), which no seller observed does; (3) a price in UGX and a same-day dispatch condition, which iFixit/Flipkart cannot give a Kampala buyer; (4) a confirm-before-you-order path (WhatsApp with model number or label photo); (5) safety line (never open a sealed phone or remove a swollen battery to read the code).
- **Claims it must never make:** "original", "genuine <brand>", a capacity not recorded, "tested by GoldPlus" for a supplier-listed fit, a stock depth, an arrival time.
- **Markup:** BreadcrumbList; ItemList of Product (mpn = pack code, brand GoldPlus, `isAccessoryOrSparePartFor` the phone, Offer with UGX price and availability, capacity only when recorded). No FAQPage (Google shows FAQ rich results only for government/health sites since 2023; the visible `<details>` FAQs are for the reader).
- **Indexability:** indexable while ≥1 public fit; `noindex,follow` otherwise; 503 + noindex when the finder is unreachable; 404 for an unknown or malformed slug.
- **Internal links:** hub, finder, this brand's other phones (from the fit index), 3–4 guides chosen by brand, delivery, shop, returns, warranty, verification.
- **Measurement:** RESULT_VIEWED on view, PRODUCT_VIEWED on "View and buy", ADDED_TO_CART on the PDP for the chosen phone (finder funnel); GA4 page_view by landing page.

### 2.2 Battery product page `/products/<slug>` (improved; template applies to all 13)
- **Changed:** Q&A heading fixed; fits list links to per-phone pages; provenance sentence no longer says "checked and published by staff" when the data says supplier-listed; "Read before you choose" guide chips by brand; Product JSON-LD gains pack code, mAh/V when recorded, `isAccessoryOrSparePartFor`; ADDED_TO_CART beacon.
- **Still thin and why:** copy is 41–48 words because the catalogue holds no more facts. The next facts to enter from the pack label are capacity (mAh), nominal voltage, warranty months. Until entered, the page is honest rather than long.
- **Better than alternatives:** the one page where code, phones, price, stock, returns and hologram verification sit together.

### 2.3 Hub `/phone-batteries` (improved)
- **Changed:** "Find a battery by phone" tile; "Batteries by phone" section listing every phone with a battery, grouped by brand, from the fit index; refreshed taxonomy comment.
- **Better than alternatives:** KWT's and Jiji's category pages list products; this one also lists phones, so a buyer who knows the phone and not the code finds the right page in one tap.

### 2.4 Buying guide — "How to find the right replacement battery for your phone" (existing guide 01)
- Already covers model number, code, label reading, and asking. Change requested of the content owner at the 30-day gate: add a short "What the GoldPlus page tells you" section explaining the two provenance labels, and a worked example with one live phone page. Not done in the pilot: guides are published through `publish-guides.ts` and the pilot changes only the four sentences that made an unbacked promise (guides 11, 14, 15, 23).

### 2.5 Comparison/compatibility guide — Tecno codes (guide 11) and Infinix/itel (guide 12) (existing)
- Serve the "why does the code matter more than the phone name" question. Linked from every Tecno/Infinix/itel phone page. CTA now points to the finder.

### 2.6 Support asset — on-page "Be sure before you order" (built into 2.1) and the swollen-battery guide (existing)
- Three numbered steps on every phone page; the swollen-battery guide is linked from the same block.

### 2.7 Selector improvement (built)
- The finder's device results now link to the per-phone page (the indexable answer) instead of a noindex query view; the `?device=` view canonicalises to the page; a typed query sends a GA4 `search` event like the shop search does.

### 2.8 Video script / demo brief — "Is this the right battery for my phone? 60 seconds" (brief only; recording is an owner decision)
- **Format:** vertical, 60 s, phone in hand, shot at the counter; captions in English; no music claims, no price in the video (prices change).
- **Shots:** (1) 0–5 s: "Same phone name, different battery. Here is how to be sure." (2) 5–20 s: Settings → About phone → model number, on a Tecno with a removable back; show the code printed on the old battery. (3) 20–35 s: open the phone's page on shopgoldplus.com, point at the pack code and the provenance label; read it aloud: "listed by our supplier — so if you are not sure, ask us first." (4) 35–50 s: WhatsApp the model number and a photo of the label; show the reply confirming the pack. (5) 50–60 s: hologram code check on /verification; "Delivered in Kampala and Wakiso, or collect on Burton Street."
- **Claims allowed:** everything shown on screen. **Not allowed:** "original", "lasts longer", any mAh.
- **Where it lives:** embedded on the hub and linked from per-phone pages once published on the YouTube channel (register: channel exists, paid placements module live). Measured as a YouTube referral landing on /phone-batteries/*.

## 3. Cluster 2 (subsequent, not started): power banks with measured Wh
- Pages: `/power/power-banks` (hub, add a measured Wh column), each power-bank PDP (add "rated Wh / measured Wh delivered at 5 V"), one guide "What 20,000 mAh really delivers".
- Blocker: no measurements exist. Needs one inline USB power meter and a written protocol (full charge → discharge at 5 V/2 A into a load until cut-off, three units, report the median). Until then every number is MFR and the cluster has no edge over Oraimo on price.
