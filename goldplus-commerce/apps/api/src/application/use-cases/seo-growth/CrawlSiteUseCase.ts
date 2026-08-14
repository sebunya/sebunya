import crypto from 'crypto';

/**
 * CrawlSiteUseCase — first-party technical crawler for shopgoldplus.com.
 *
 * SECURITY (SSRF): the crawler will only ever fetch hosts on a hard allowlist
 * — shopgoldplus.com, www.shopgoldplus.com, plus at most ONE staging host from
 * SEO_CRAWL_EXTRA_HOST. IP-literal hosts, non-http(s) schemes and redirects
 * that leave the allowlist are refused. The allowlist is enforced on EVERY
 * hop, not just the seed.
 *
 * Limits: maxPages default 200 (cap 2000), depth 6, concurrency 4, 10s
 * timeout per request, 150ms politeness delay, visited-set + content-hash
 * loop protection, text/html only.
 *
 * Parsing is dependency-free regex extraction — good enough for our own
 * server-rendered storefront, and honest about being heuristic.
 */

export interface SeoPageFetchResult {
  status: number;
  contentType: string | null;
  location: string | null;
  body: string | null;
  responseMs: number;
}

export interface SeoPageFetcher {
  /** Single request, redirect: manual, 10s timeout. */
  fetchPage(url: string): Promise<SeoPageFetchResult>;
}

export interface CrawlRunStore {
  getCrawlRun(runId: string): Promise<{ id: string; status: string } | null>;
  insertCrawlPages(runId: string, pages: any[]): Promise<number>;
  finishCrawlRun(runId: string, outcome: { status: 'COMPLETE' | 'FAILED' | 'CANCELLED'; pagesCrawled: number; notes?: string | null }): Promise<any>;
  replaceLinkGraphForPath(fromPath: string, links: Array<{ toPath: string; anchor?: string | null }>): Promise<number>;
  raiseAlert(input: { severity: string; kind: string; message: string; dedupeKey: string }): Promise<any>;
}

export interface CrawlOptions {
  startUrl?: string;
  maxPages?: number;
  extraHost?: string | null;
}

const BASE_ALLOWLIST = ['shopgoldplus.com', 'www.shopgoldplus.com'];
const MAX_DEPTH = 6;
const CONCURRENCY = 4;
const POLITENESS_MS = 150;
const MAX_REDIRECT_HOPS = 5;

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function buildAllowlist(extraHost?: string | null): string[] {
  const list = [...BASE_ALLOWLIST];
  const extra = (extraHost ?? '').trim().toLowerCase();
  if (extra && !IPV4_RE.test(extra) && !extra.includes(':') && !list.includes(extra)) list.push(extra);
  return list;
}

/** SSRF gate: http(s) only, allowlisted hostname, never an IP literal. */
export function isAllowedUrl(rawUrl: string, allowlist: string[]): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (IPV4_RE.test(host)) return false;
  if (host.startsWith('[') || host.includes(':')) return false; // IPv6 literal
  return allowlist.includes(host);
}

// ── Regex extraction helpers (exported for tests) ──────────────────────────

const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

export function extractPageFacts(html: string, pageUrl: string, allowlist: string[]): {
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  h1: string | null;
  h2Count: number;
  imagesMissingAlt: number;
  internalLinks: Array<{ href: string; anchor: string | null }>;
  structuredDataTypes: string[];
  wordCount: number;
} {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const meta = (name: string): string | null => {
    const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, 'i');
    const tag = re.exec(html)?.[0];
    if (!tag) return null;
    const content = /content=["']([\s\S]*?)["']/i.exec(tag)?.[1];
    return content != null ? decode(content) : null;
  };
  const canonicalTag = /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(html)?.[0] ?? null;
  const canonical = canonicalTag ? /href=["']([^"']+)["']/i.exec(canonicalTag)?.[1] ?? null : null;
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const h2Count = (html.match(/<h2[\s>]/gi) ?? []).length;

  let imagesMissingAlt = 0;
  for (const img of html.match(/<img\b[^>]*>/gi) ?? []) {
    const alt = /alt=["']([\s\S]*?)["']/i.exec(img)?.[1];
    if (alt == null || alt.trim() === '') imagesMissingAlt += 1;
  }

  const internalLinks: Array<{ href: string; anchor: string | null }> = [];
  const aRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html)) !== null) {
    const href = m[1].trim();
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!allowlist.includes(resolved.hostname.toLowerCase())) continue;
    const anchorText = decode(strip(m[2])).replace(/\s+/g, ' ').trim() || null;
    internalLinks.push({ href: resolved.toString(), anchor: anchorText });
  }

  const structuredDataTypes: string[] = [];
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld: RegExpExecArray | null;
  while ((ld = ldRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(ld[1]);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const t = node?.['@type'];
        for (const one of Array.isArray(t) ? t : [t]) {
          if (typeof one === 'string' && !structuredDataTypes.includes(one)) structuredDataTypes.push(one);
        }
      }
    } catch { /* invalid JSON-LD: not a fact, skip */ }
  }

  const text = strip(html).replace(/\s+/g, ' ').trim();
  const wordCount = text === '' ? 0 : text.split(' ').length;

  return {
    title: title != null ? decode(title).replace(/\s+/g, ' ') || null : null,
    metaDescription: meta('description'),
    metaRobots: meta('robots'),
    canonical,
    h1: h1 != null ? decode(strip(h1)).replace(/\s+/g, ' ').trim() || null : null,
    h2Count,
    imagesMissingAlt,
    internalLinks,
    structuredDataTypes,
    wordCount,
  };
}

const toPath = (url: string): string => {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search : '');
  } catch {
    return url;
  }
};

const isCommercialPath = (path: string) => path.startsWith('/products/') || path.startsWith('/shop');

/**
 * A commercial page that is EXPECTED to be indexable.
 *
 * The alert exists to catch a page that should rank but silently carries
 * noindex. It was firing on every filtered /shop URL, which the canonical
 * CrawlPolicy noindexes on purpose: search results, stacked filters and sort
 * variants are never indexable, and a category facet is indexable only once an
 * operator has written unique copy for it. With no category copy authored,
 * noindex on those URLs is the policy working, not a defect — so a CRITICAL
 * alert there trains operators to ignore the alert.
 *
 * Product pages and the bare /shop listing keep their alert: those genuinely
 * should be indexable, and noindex on them is a real problem.
 */
const isExpectedIndexable = (path: string, url: string) => {
  if (path.startsWith('/products/')) return true;
  if (!path.startsWith('/shop')) return false;
  try {
    // Any query parameter makes this a facet, governed by CrawlPolicy.
    return new URL(url).searchParams.toString() === '';
  } catch {
    return !url.includes('?');
  }
};

export interface CrawlOutcome {
  status: 'COMPLETE' | 'FAILED' | 'CANCELLED' | 'REFUSED';
  pagesCrawled: number;
  issuesFound: number;
  refusedReason?: string;
}

export class CrawlSiteUseCase {
  constructor(
    private readonly store: CrawlRunStore,
    private readonly fetcher: SeoPageFetcher,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async execute(runId: string, options: CrawlOptions = {}): Promise<CrawlOutcome> {
    const allowlist = buildAllowlist(options.extraHost ?? process.env.SEO_CRAWL_EXTRA_HOST ?? null);
    const startUrl = options.startUrl ?? 'https://www.shopgoldplus.com/';
    const maxPages = Math.min(Math.max(options.maxPages ?? 200, 1), 2000);

    if (!isAllowedUrl(startUrl, allowlist)) {
      const reason = `Start URL refused by crawl allowlist: ${startUrl}`;
      await this.store.finishCrawlRun(runId, { status: 'FAILED', pagesCrawled: 0, notes: reason });
      return { status: 'REFUSED', pagesCrawled: 0, issuesFound: 0, refusedReason: reason };
    }

    const visitedUrls = new Set<string>();
    const seenHashes = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
    let pagesCrawled = 0;
    let issuesFound = 0;
    let count5xx = 0;
    let noindexCommercial: string[] = [];

    const crawlOne = async (url: string, depth: number): Promise<void> => {
      // Follow redirects manually so every hop is allowlist-checked.
      const redirectChain: string[] = [];
      let current = url;
      let result: SeoPageFetchResult | null = null;
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        if (!isAllowedUrl(current, allowlist)) {
          // Redirect escaped the allowlist — record what we saw, go no further.
          result = null;
          break;
        }
        const r = await this.fetcher.fetchPage(current);
        if (r.status >= 300 && r.status < 400 && r.location) {
          redirectChain.push(current);
          let next: string;
          try {
            next = new URL(r.location, current).toString();
          } catch {
            result = r;
            break;
          }
          current = next;
          result = r;
          continue;
        }
        result = r;
        break;
      }
      if (result == null) {
        // Escaped allowlist or unusable redirect: persist the refusal honestly.
        await this.store.insertCrawlPages(runId, [{
          url, finalUrl: current, httpStatus: 0, redirectChain,
          issues: ['REDIRECT_OFF_ALLOWLIST'],
        }]);
        pagesCrawled += 1;
        issuesFound += 1;
        return;
      }

      const finalUrl = current;
      const issues: string[] = [];
      if (redirectChain.length > 2) issues.push('REDIRECT_CHAIN>2');
      if (result.status >= 400 && result.status < 500) issues.push('HTTP_4XX');
      if (result.status >= 500) { issues.push('HTTP_5XX'); count5xx += 1; }

      const isHtml = (result.contentType ?? '').toLowerCase().includes('text/html');
      let facts: ReturnType<typeof extractPageFacts> | null = null;
      let contentHash: string | null = null;
      if (isHtml && result.body != null) {
        contentHash = crypto.createHash('sha256').update(result.body).digest('hex');
        if (seenHashes.has(contentHash)) {
          // Loop/duplicate protection: record the page, do not expand its links.
          facts = extractPageFacts(result.body, finalUrl, allowlist);
        } else {
          seenHashes.add(contentHash);
          facts = extractPageFacts(result.body, finalUrl, allowlist);
          if (depth < MAX_DEPTH) {
            for (const link of facts.internalLinks) {
              const clean = link.href.split('#')[0];
              if (!visitedUrls.has(clean) && visitedUrls.size + queue.length < maxPages * 4) {
                queue.push({ url: clean, depth: depth + 1 });
              }
            }
          }
        }
        if (result.status === 200) {
          if (!facts.title) issues.push('MISSING_TITLE');
          if (!facts.metaDescription) issues.push('MISSING_META_DESCRIPTION');
          if (!facts.h1) issues.push('MISSING_H1');
          const robots = (facts.metaRobots ?? '').toLowerCase();
          if (robots.includes('noindex') && isCommercialPath(toPath(finalUrl))) {
            // Recorded on the page either way, so the evidence is never lost.
            issues.push('NOINDEX_COMMERCIAL');
            // Escalated only when the page was supposed to be indexable.
            if (isExpectedIndexable(toPath(finalUrl), finalUrl)) {
              noindexCommercial.push(toPath(finalUrl));
            }
          }
        }
      }

      issuesFound += issues.length;
      await this.store.insertCrawlPages(runId, [{
        url,
        finalUrl,
        httpStatus: result.status,
        redirectChain,
        contentType: result.contentType,
        canonical: facts?.canonical ?? null,
        metaRobots: facts?.metaRobots ?? null,
        title: facts?.title ?? null,
        metaDescription: facts?.metaDescription ?? null,
        h1: facts?.h1 ?? null,
        headings: facts ? { h2Count: facts.h2Count } : null,
        wordCount: facts?.wordCount ?? null,
        imagesMissingAlt: facts?.imagesMissingAlt ?? null,
        internalLinks: facts ? facts.internalLinks.map((l) => toPath(l.href)) : null,
        structuredDataTypes: facts?.structuredDataTypes ?? null,
        issues,
        responseMs: result.responseMs,
        contentHash,
      }]);
      if (facts) {
        await this.store.replaceLinkGraphForPath(
          toPath(finalUrl),
          facts.internalLinks.map((l) => ({ toPath: toPath(l.href), anchor: l.anchor })),
        );
      }
      pagesCrawled += 1;
    };

    try {
      while (queue.length > 0 && pagesCrawled < maxPages) {
        // Cancellation check between batches of pages.
        const run = await this.store.getCrawlRun(runId);
        if (!run || run.status === 'CANCELLED') {
          await this.store.finishCrawlRun(runId, { status: 'CANCELLED', pagesCrawled });
          return { status: 'CANCELLED', pagesCrawled, issuesFound };
        }

        const batch: Array<{ url: string; depth: number }> = [];
        while (batch.length < CONCURRENCY && queue.length > 0 && pagesCrawled + batch.length < maxPages) {
          const next = queue.shift()!;
          const clean = next.url.split('#')[0];
          if (visitedUrls.has(clean)) continue;
          visitedUrls.add(clean);
          batch.push({ url: clean, depth: next.depth });
        }
        if (batch.length === 0) continue;
        await Promise.all(batch.map((b) => crawlOne(b.url, b.depth)));
        await this.sleep(POLITENESS_MS);
      }

      // Alerts: real crawl evidence only.
      if (noindexCommercial.length > 0) {
        await this.store.raiseAlert({
          severity: 'CRITICAL',
          kind: 'NOINDEX_COMMERCIAL',
          message: `Crawl ${runId} found noindex on ${noindexCommercial.length} commercial page(s): ${noindexCommercial.slice(0, 5).join(', ')}${noindexCommercial.length > 5 ? '…' : ''}`,
          dedupeKey: 'NOINDEX_COMMERCIAL',
        });
      }
      if (pagesCrawled > 0 && count5xx / pagesCrawled > 0.2) {
        await this.store.raiseAlert({
          severity: 'CRITICAL',
          kind: 'CRAWL_5XX_RATE',
          message: `Crawl ${runId}: ${count5xx}/${pagesCrawled} pages returned 5xx (${Math.round((count5xx / pagesCrawled) * 100)}%).`,
          dedupeKey: 'CRAWL_5XX_RATE',
        });
      }

      await this.store.finishCrawlRun(runId, { status: 'COMPLETE', pagesCrawled });
      return { status: 'COMPLETE', pagesCrawled, issuesFound };
    } catch (err) {
      await this.store.finishCrawlRun(runId, {
        status: 'FAILED',
        pagesCrawled,
        notes: err instanceof Error ? err.message : String(err),
      });
      return { status: 'FAILED', pagesCrawled, issuesFound };
    }
  }
}
