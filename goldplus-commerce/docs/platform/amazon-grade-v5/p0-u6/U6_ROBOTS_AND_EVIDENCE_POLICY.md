# U6 — robots policy decision & external-evidence honesty

## AI-crawler robots.txt decision (explicit, not accidental)

The current robots.txt has a single `User-agent: *` block, so every AI crawler is
allowed by accident. The **implemented decision** (a product decision, per the
spec) is:

- **ALLOW** the AI answer/search crawlers that produce citations driving
  qualified traffic: `OAI-SearchBot`, `PerplexityBot`, `ClaudeBot`,
  `Google-Extended` (AI Overviews/Gemini grounding). **Why:** AEO is an explicit
  U6 objective; being citable in AI answers is the largest emerging discovery
  channel for an accessories retailer, and these crawlers attribute/link back.
- **DISALLOW** bulk training-only scrapers with no citation/traffic benefit:
  `GPTBot`, `CCBot`. **Why:** they consume crawl budget and content for model
  training without returning discovery value; excluding them is a deliberate cost
  decision, reversible if the calculus changes.
- Standard search crawlers (`Googlebot`, `Bingbot`) remain fully allowed.

This is a documented, reversible configuration decision. The actual robots.txt
edit + `llms.txt` index are the presentation-layer deliverable wired to this
decision.

## External-evidence honesty (no fabrication)

The following U6 acceptance criteria require **real external tools/credentials**
and are NOT fabricated in this build:

- **AC3** — Google Rich Results Test result paste. The JSON-LD *shapes* are built
  and unit-tested (`domain/seo/StructuredData.ts`); an operator runs the external
  validator and pastes the result.
- **AC7 (live)** — Google Search Console API ingestion. The warehouse table
  (`gsc_performance`) and the clicks-by-product query are built and proven with
  seeded data; live ingestion uses real GSC credentials.
- **AC8** — Lighthouse mobile performance score under simulated 3G. Requires a
  running web build + Lighthouse; the score is measured, not invented. The
  image-transform/srcset performance work is the presentation deliverable.
- **AC1 serving** — sitemap generation-to-object-storage + CDN + IndexNow
  submission require configured infrastructure; the *enumeration query* (every
  approved active product, real lastmod) is built and proven.

## Proven in this build (real PostgreSQL / unit)

AC1 (sitemap enumerates all approved-active products, not 60), AC2 (lastmod =
`products.updated_at`, migration 0075), AC4 (device page ≥3 compatible products —
U2 `compatibleProducts`), AC5 (facet/crawl policy), AC6 (slug change → 301 auto,
old URL resolves), AC7 (GSC warehouse + clicks-by-product-28d query), and the AC3
JSON-LD node shapes.
