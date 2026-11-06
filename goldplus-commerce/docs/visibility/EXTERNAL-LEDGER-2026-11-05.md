# Visibility gaps: external dependencies and benchmark (2026-11-05)

Companion to the visibility-gaps brief (owner's GoldPlus_Claude_Code_All_Visibility_Gaps.md). Code tickets live in PRs
#288 (journeys, LIVE 31a0fdd9), #289 (trust) and the product-facts PR. This page holds what code cannot close:
each row names the owner, the evidence seen on 2026-11-05 and the next action. Nothing here is "passed" by CI.

## Crawler and search access (checked 2026-11-05 with plain GETs; a copied user agent tests routing only)

| Service | What was checked | Result | Owner / next action |
|---|---|---|---|
| OpenAI: OAI-SearchBot (search), ChatGPT-User (user fetch), GPTBot (training) | robots.txt group; edge answer to each UA on /llms.txt | All three allowed in robots.txt (one shared group, private paths disallowed); edge returned 200 to each | Owner: confirm verified-IP traffic in Cloudflare Security > Events (filter by OpenAI ASNs) before claiming real crawler access |
| Anthropic: ClaudeBot, Claude-SearchBot, Claude-User | same | Allowed; 200 | Same as above |
| Perplexity: PerplexityBot, Perplexity-User | same | Allowed; 200 | Same |
| Google Search vs Google-Extended (Gemini training) | robots.txt | Googlebot and Google-Extended allowed; no nosnippet/max-snippet limits on product pages | Owner: Search Console > Pages and Performance; Google-Extended is a training control, not a Search control |
| Mistral: MistralAI-User | edge | **403** from Cloudflare AI Crawl Control per-crawler block | Owner: Cloudflare > Security > AI Crawl Control > MistralAI-User > Allow |
| Bing / Copilot | not checked (needs Bing Webmaster access) | unknown | Owner: verify site in Bing Webmaster Tools, submit sitemap.xml, read AI Performance (preview). IndexNow only if a freshness need is shown |
| Robots `Content-Signal: ai-train=yes` | Lighthouse calls it an unknown directive (SEO score) | harmless to crawlers that ignore it | Owner choice; no change made |

## Commerce and feeds

| Destination | State on 2026-11-05 | Next action |
|---|---|---|
| Google Merchant Center 5837876651 | Primary source "PRODUCTS SOURCE 2" = api.shopgoldplus.com/seo/merchant-feed.xml, daily, Uganda, English, label UG, free listings; first fetch 77 products, no issues | Owner: business address in Merchant Center to Wilson Road; Shopping ads need the Google Ads link approved |
| Google Ads 916-133-9749 | Link request from Merchant Center sent; account still in sign-up, set to **Rwanda** country, unpaid | Owner: choose billing country, add payment, approve the Merchant link |
| Meta catalogue 3708123826002678 | Hourly feed, 77 products; ad account 2930016940731357 exists | Owner: Meta account verification prompt; then confirm catalogue + dataset connected to the ad account |
| OpenAI product feeds / Perplexity shopping | not checked | Owner: confirm current country/currency eligibility (Uganda, UGX) in their docs before any feed work |
| TikTok / Snapchat | Uganda not accepted (earlier sign-up attempts) | Revisit for Kenya/Rwanda when those markets go live |

## Local trust

| Record | State | Next action |
|---|---|---|
| Google Business Profile (CID 2567724259551649466) | Address line 1 edited to "Zainab Aziza Building, 4th Floor, Wilson Road" in the editor, **not saved** (Save is the owner's click) | Owner: press Save; watch for a re-verification request |
| Bing Places, third-party directories | not checked | Marketing: one pass with the exact NAP from /locations/zainab-aziza |
| Real dealer references | none listed (/dealers is noindex while empty) | Sales: list dealers in /admin/dealers when real |

## Neutral benchmark (use the existing module, not a new tool)

The AI search module (`/admin/ai-search`, docs/ai-visibility/README.md) already keeps mentions and citations as separate
measures with their own denominators, never blends them, and refuses to run without provider keys. Research runs never
change tracked questions; a person adds them. Load the panel below as tracked questions, then run three fresh trials per
prompt per provider on separate days. Record unrun trials as unrun.

**Unbranded (20)**
1. I want to buy phone accessories in Kampala in wholesale.
2. Can I get a mixed order of phone accessories for a new shop in Mbarara?
3. Which Kampala sellers can tell me how many charging cables are in a carton?
4. Where can I buy power banks by the carton in Uganda?
5. Can a magnetic case make my phone charge wirelessly?
6. Which 20,000mAh power bank can I buy in Kampala with same-day delivery?
7. Where do I find a replacement battery for a Tecno Spark 7 in Kampala?
8. Is a 45W charger safe for my Samsung A14?
9. Where can I buy a genuine USB-C fast charger in Kampala?
10. What flash drive works with a laptop that only has USB-C ports?
11. Which shop in Kampala sells car chargers for long trips upcountry?
12. Where can I buy earbuds in Kampala and pick them up today?
13. How do I check if a charger I bought in Kampala is genuine?
14. Who delivers phone accessories to Wakiso the same day?
15. Can I get phone accessories sent upcountry by bus from Kampala?
16. Where can I buy a memory card in bulk for resale in Uganda?
17. Which power bank can I take on a plane from Entebbe?
18. What is a good charger to buy as a gift in Kampala?
19. Where can I get a quote for 500 phone chargers in Uganda?
20. Which electronics shop is opposite Pioneer Mall in Kampala?

**Branded controls (5)**
21. Is GoldPlus a real shop in Kampala?
22. Where is the GoldPlus shop?
23. Does GoldPlus sell wholesale?
24. GoldPlus GP-W2 power bank price.
25. Does GoldPlus deliver the same day?

Negative control: "Where can I buy a used car in Kampala?" GoldPlus should not appear.

Report per surface separately: correctly supported recommendations, unprompted mentions, domain citations, qualified
enquiries (from quote_requests by landing page, docs/measurement/OUTCOMES.md). Bot access and index coverage diagnose
retrieval; neither explains why an answer chose a supplier.
