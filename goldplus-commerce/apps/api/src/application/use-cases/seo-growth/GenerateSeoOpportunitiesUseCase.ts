/**
 * GenerateSeoOpportunitiesUseCase — derives seo_opportunities rows ONLY from
 * evidence that already exists in this database. Nothing here estimates,
 * extrapolates or invents: an empty gsc_performance table yields zero GSC
 * opportunities and says so; a product missing an image is an ATTRIBUTE_GAP
 * because the products row says so.
 *
 * Sources:
 *  (a) gsc_performance     — high-impression / low-CTR pages+queries, and
 *                            position bands 2–5 / 5–10 / 11–20 (striking distance)
 *  (b) products            — missing imageUrl / shortDescription / empty specs
 *  (c) latest crawl run    — missing title/meta/h1, 4xx, 5xx pages
 *  (d) link graph          — orphan commercial paths
 *
 * Dedupe: one OPEN opportunity per (kind, url-or-query anchor). Existing rows
 * are updated in place; new anchors insert.
 */

export interface GscOpportunityRow {
  page: string;
  query: string;
  impressions: number;
  clicks: number;
  position: number | null;
}

export interface ProductGapRow {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  shortDescription: string;
  specifications: Record<string, unknown>;
}

export interface CrawlIssuePageRow {
  url: string;
  finalUrl: string;
  httpStatus: number;
  issues: string[];
}

export interface OpportunityWriteInput {
  id?: string;
  kind: string;
  title: string;
  detail: string;
  url?: string | null;
  opportunityValue?: string;
  evidenceConfidence?: string;
  effort?: string;
  risk?: string;
  status?: string;
  source: string;
  evidence?: Record<string, unknown> | null;
}

export interface GenerateSeoOpportunitiesDeps {
  /** Aggregated GSC rows for the window; empty array when the table is empty. */
  gscRows(windowDays: number): Promise<GscOpportunityRow[]>;
  /** Published/visible catalogue rows with the three audited attributes. */
  products(): Promise<ProductGapRow[]>;
  /** Pages of the latest COMPLETE crawl run that carry issues. */
  latestCrawlIssuePages(): Promise<CrawlIssuePageRow[]>;
  /** Link graph stats incl. orphan commercial paths. */
  linkGraphStats(): Promise<{ orphanPaths: string[] }>;
  /** Existing non-dismissed opportunities, for dedupe. */
  listOpenOpportunities(): Promise<Array<{ id: string; kind: string; url: string | null; evidence: unknown }>>;
  upsertOpportunity(input: OpportunityWriteInput): Promise<unknown>;
}

export interface GenerateSeoOpportunitiesResult {
  countsPerKind: Record<string, number>;
  created: number;
  updated: number;
  gscRowsExamined: number;
  notes: string[];
}

const SOURCE = 'GENERATOR';

export class GenerateSeoOpportunitiesUseCase {
  constructor(private readonly deps: GenerateSeoOpportunitiesDeps) {}

  async execute(input?: { windowDays?: number }): Promise<GenerateSeoOpportunitiesResult> {
    const windowDays = Math.min(Math.max(Math.floor(input?.windowDays ?? 28), 1), 365);
    const notes: string[] = [];
    const candidates: Array<OpportunityWriteInput & { anchor: string }> = [];

    // (a) GSC-derived — honest zero when the warehouse is empty.
    const gsc = await this.deps.gscRows(windowDays);
    if (gsc.length === 0) {
      notes.push(`gsc_performance has no rows in the last ${windowDays} days — 0 GSC-derived opportunities (no estimation).`);
    } else {
      for (const r of gsc) {
        const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0;
        if (r.impressions >= 100 && ctr < 0.01) {
          candidates.push({
            anchor: `HIGH_IMPRESSION_LOW_CTR|${r.page}|${r.query}`,
            kind: 'HIGH_IMPRESSION_LOW_CTR',
            title: `High impressions, low CTR: "${r.query}"`,
            detail: `${r.page} received ${r.impressions} impressions for "${r.query}" with CTR ${(ctr * 100).toFixed(2)}% in the last ${windowDays} days. Title/description likely under-selling the page.`,
            url: r.page,
            opportunityValue: 'HIGH',
            evidenceConfidence: 'HIGH',
            effort: 'S',
            source: SOURCE,
            evidence: { page: r.page, query: r.query, impressions: r.impressions, clicks: r.clicks, ctr, windowDays },
          });
        }
        const pos = r.position;
        if (pos != null && r.impressions >= 20) {
          const band = pos >= 2 && pos < 5 ? 'POSITION_2_5' : pos >= 5 && pos < 10 ? 'POSITION_5_10' : pos >= 11 && pos <= 20 ? 'STRIKING_DISTANCE_11_20' : null;
          if (band) {
            candidates.push({
              anchor: `${band}|${r.page}|${r.query}`,
              kind: band,
              title: `Striking distance (${band}): "${r.query}"`,
              detail: `${r.page} averages position ${pos.toFixed(1)} for "${r.query}" (${r.impressions} impressions, ${r.clicks} clicks, last ${windowDays} days).`,
              url: r.page,
              opportunityValue: band === 'POSITION_2_5' ? 'HIGH' : 'MEDIUM',
              evidenceConfidence: 'HIGH',
              effort: 'M',
              source: SOURCE,
              evidence: { page: r.page, query: r.query, position: pos, impressions: r.impressions, clicks: r.clicks, windowDays },
            });
          }
        }
      }
    }

    // (b) Product attribute gaps — read straight off the catalogue rows.
    const products = await this.deps.products();
    for (const p of products) {
      const missing: string[] = [];
      if (!p.imageUrl || p.imageUrl.trim() === '') missing.push('imageUrl');
      if (!p.shortDescription || p.shortDescription.trim() === '') missing.push('shortDescription');
      if (!p.specifications || Object.keys(p.specifications).length === 0) missing.push('specifications');
      if (missing.length === 0) continue;
      const url = `/products/${p.slug}`;
      candidates.push({
        anchor: `ATTRIBUTE_GAP|${url}`,
        kind: 'ATTRIBUTE_GAP',
        title: `Product content gap: ${p.name}`,
        detail: `${url} is missing ${missing.join(', ')}. Thin product content suppresses both rankings and conversion.`,
        url,
        opportunityValue: 'MEDIUM',
        evidenceConfidence: 'HIGH',
        effort: 'S',
        source: SOURCE,
        evidence: { productId: p.id, missing },
      });
    }

    // (c) Technical issues from the latest crawl.
    const crawlPages = await this.deps.latestCrawlIssuePages();
    if (crawlPages.length === 0) notes.push('No crawl pages with issues (or no completed crawl yet) — 0 technical opportunities.');
    for (const page of crawlPages) {
      const issues = page.issues.filter((i) =>
        ['MISSING_TITLE', 'MISSING_META_DESCRIPTION', 'MISSING_H1', 'HTTP_4XX', 'HTTP_5XX'].includes(i));
      if (issues.length === 0) continue;
      const kind = 'TECHNICAL_ISSUE';
      candidates.push({
        anchor: `${kind}|${page.url}`,
        kind,
        title: `Crawl issue${issues.length > 1 ? 's' : ''} on ${page.url}`,
        detail: `Latest crawl found: ${issues.join(', ')} (HTTP ${page.httpStatus}).`,
        url: page.url,
        opportunityValue: issues.some((i) => i.startsWith('HTTP_')) ? 'HIGH' : 'MEDIUM',
        evidenceConfidence: 'HIGH',
        effort: 'S',
        risk: 'LOW',
        source: SOURCE,
        evidence: { issues, httpStatus: page.httpStatus, finalUrl: page.finalUrl },
      });
    }

    // (d) Orphan commercial pages.
    const stats = await this.deps.linkGraphStats();
    for (const path of stats.orphanPaths) {
      candidates.push({
        anchor: `INTERNAL_LINK_GAP|${path}`,
        kind: 'INTERNAL_LINK_GAP',
        title: `Orphan page: ${path}`,
        detail: `${path} was reachable in the latest crawl but has no internal links pointing at it — search engines and shoppers can only find it by URL.`,
        url: path,
        opportunityValue: 'MEDIUM',
        evidenceConfidence: 'HIGH',
        effort: 'S',
        source: SOURCE,
        evidence: { orphanPath: path },
      });
    }

    // Dedupe against existing open rows on (kind, anchor url/query key).
    const existing = await this.deps.listOpenOpportunities();
    const existingByAnchor = new Map<string, string>();
    for (const e of existing) {
      const ev = (e.evidence ?? {}) as Record<string, unknown>;
      const anchor = typeof ev.anchor === 'string' ? ev.anchor : `${e.kind}|${e.url ?? ''}`;
      existingByAnchor.set(anchor, e.id);
    }

    let created = 0;
    let updated = 0;
    const countsPerKind: Record<string, number> = {};
    const seen = new Set<string>();
    for (const cand of candidates) {
      if (seen.has(cand.anchor)) continue; // in-batch dedupe
      seen.add(cand.anchor);
      const { anchor, ...write } = cand;
      const payload: OpportunityWriteInput = {
        ...write,
        evidence: { ...(write.evidence ?? {}), anchor },
      };
      const existingId = existingByAnchor.get(anchor);
      if (existingId) {
        await this.deps.upsertOpportunity({ ...payload, id: existingId, status: 'OPEN' });
        updated += 1;
      } else {
        await this.deps.upsertOpportunity(payload);
        created += 1;
      }
      countsPerKind[cand.kind] = (countsPerKind[cand.kind] ?? 0) + 1;
    }

    return { countsPerKind, created, updated, gscRowsExamined: gsc.length, notes };
  }
}
