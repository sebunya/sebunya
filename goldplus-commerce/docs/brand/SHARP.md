# Byron Sharp audit of GoldPlus (How Brands Grow)

Date: 2026-11-04. Method: the same as the Kaushik and Baymard registers: each claim from *How Brands Grow* (Sharp, 2010)
and *How Brands Grow Part 2* (Romaniuk & Sharp, 2016) is first self-critiqued for a web-first, own-brand accessories line
with a pan-African ambition, then scored against the code with file and line as evidence, then fixed in waves. Nothing is
scored from a browser; every row names the code it was read from. Frame: GoldPlus is a white-label brand with its own
product line from manufacturing, today sold from Kampala; a fix is judged by whether it still holds in a second country.

Scores: MET, PARTIAL, MISSING, N/A. Line numbers are as of the deploy tip 8bbedd48.

## Part 1: the laws, and what each means for a shop that sells online

| # | Law / claim (Sharp) | Self-critique for GoldPlus | Verdict |
|---|---|---|---|
| L1 | Growth comes from penetration (more buyers, mostly light ones), not from loyalty | Holds everywhere it has been tested, including e-commerce. For a young brand with ~19 sessions a week the whole game is new buyers. | Keep: the register weights acquisition surfaces over retention surfaces |
| L2 | Double jeopardy: small brands have fewer buyers who are also slightly less loyal | Holds. Do not read low repeat rates as a product problem; read them as a size problem. | Keep: a guide for reading the Outcomes page, not a code change |
| L3 | Mental availability: be thought of in more buying situations (category entry points), not "loved" | Holds. Online, the CEPs are the search queries and the pages that answer them: "charger for Samsung A14", "phone dies fast", "gift for a student", "bulk for my shop". | Keep: the biggest code lever |
| L4 | Physical availability: presence, prominence, portfolio wherever the category is bought | Holds. Online it is: be findable in search engines and marketplaces, be buyable without friction, show the whole range, say where else to buy (dealers, shop, pickup, upcountry). | Keep |
| L5 | Distinctive assets (logo, colour, tagline, pack shapes) used consistently so memory links to the brand | Holds, and is cheap: every surface must carry the same lime, wordmark and one brand line. | Keep |
| L6 | Reach beats targeting; buy reach across the whole category | Holds. For a web brand this is also: pages for every CEP, not a narrow persona; broad SEO and broad ad audiences. | Keep, mostly owner-side (ad accounts) |
| L7 | Never go dark: continuous presence refreshes memory structures | Holds. Means a cadence of brand presence (SMS/WhatsApp broadcasts, posts, blog) and an audience to reach, which needs opt-ins beyond buyers. | Keep |
| L8 | Loyalty programmes have small effects; they reward existing heavy buyers | Holds. The shop has a full programme (points, tiers, referrals, missions). Not to be removed, but it must not crowd out acquisition messaging on the surfaces light buyers see first. | Keep: re-weight, do not remove |
| L9 | Price promotions pull forward sales from existing buyers; they rarely win new ones | Holds. Flash sales and countdowns are fine as tactics; the shop window must not lead with them. | Keep |
| L10 | Attitudes follow behaviour; brand beliefs are mostly a function of usage | Holds. Reviews and "what buyers say" are evidence of use; collecting and showing them is right. Do not chase "brand love" copy. | Keep |
| L11 | Pareto is 60/20, not 80/20; light buyers matter | Holds. Whales exist (Outcomes page) but the long tail of one-order customers is where growth is. | Keep: guide for reading data |
| L12 | Brand users of competing brands look alike; do not segment by "type of person" | Holds. Personalised shop ordering by interest is fine as relevance; persona-based copy is not. | Keep |
| L13 | Duplication of purchase: your buyers also buy competitors in proportion to size | Holds. Means competitor-brand queries (Oraimo, Anker) are CEPs too: answer them honestly with the GoldPlus equivalent. | Keep |
| L14 | Advertising works by refreshing and building memory structures, with the brand clearly present | Holds. On the site: the brand name and lime in the first screen of every page, product names that carry "GoldPlus". | Keep |
| L15 | Category buying is mostly habitual and low-involvement; make the brand easy to notice and buy | Holds. Baymard covered friction; Sharp adds: be the easy default (brand on the card, one tap to buy, no account). | Keep |

Part 2 (the scored register) follows.

## Part 2: scored register (evidence at deploy tip 8bbedd48)

| # | Row | Before | Fix | After |
|---|---|---|---|---|
| D1 | One brand line | MISSING: six variants, all "a shop in Kampala" (BaseLayout default description, manifest, home title, homepage card, invite, email eyebrow) | `BRAND_LINE` in packages/shared/src/brand; read by layout default description, footer, home strip, About, manifest; email eyebrow "GOLDPLUS · PHONE & COMPUTER ACCESSORIES" | MET (invite + referral card copy still own words: wave 2) |
| D2 | Wordmark on every page | PARTIAL: nav only; footer and receipt bare | Footer wordmark + line | PARTIAL (receipt: wave 2) |
| D3 | Brand story page | MISSING | /about, footer link | MET |
| D4 | Brand named once in titles and shares | PARTIAL: "GoldPlus … at GoldPlus" share line; PDP title brand only if in the name | `brandTitle`, `stripBrandPrefix` | MET |
| D5 | One greeting on WhatsApp | PARTIAL: "Hi" vs "Hello" | "Hello GoldPlus" everywhere | MET |
| D6 | Typography | PARTIAL: three faces (Jakarta, Poppins, Montserrat) | none yet: owner design call | OPEN |
| D7 | Theme colour / PWA name | PARTIAL: "GoldPlus Commerce" | name fixed; theme-color kept black (matches nav) | MET |
| M1 | First visible sentence says what we sell | PARTIAL: hidden h1, hero opens on a sale | category strip under the hero; range slide first by default | MET |
| M2 | Titles lead with category words | PARTIAL: "Shop products" | shop + home titles lead with category words | MET |
| M3 | Brand and competitor queries | MISSING | brand words leave the match; competitor named openly with our line | MET |
| M4 | Situation pages (gift, fast charging, travel, car, charger-for-phone) | PARTIAL: guides and finders only | none yet | OPEN: wave 2 |
| P1 | Where to buy beyond Kampala | PARTIAL: no public upcountry page, no dealer locator | About says it; pages next | OPEN: wave 2 (dealer list needs owner data) |
| P2 | Second-country readiness | MISSING: no market abstraction, ~300 files | none: a programme, not a wave | OPEN: owner to pick the second country first |
| P3 | Feeds and ad reach switched on | PARTIAL: feeds built, destinations unconnected | owner-side | OPEN (owner) |
| G1 | Promotions lead the shop window | PARTIAL: flash slide first, live "On sale" nav | flash moved to slide 8 by default (stored order unchanged) | PARTIAL: owner can reorder in admin hero |
| G2 | Loyalty weight on light-buyer surfaces | PARTIAL (heavy) | none yet: re-weight, never remove | OPEN: wave 2 |
| G3 | Audience capture for non-buyers | PARTIAL: WhatsApp channel only | none yet | OPEN |
