import { describe, expect, it } from 'vitest';
import {
  GenerateSeoOpportunitiesUseCase,
  GenerateSeoOpportunitiesDeps,
  OpportunityWriteInput,
} from '../../apps/api/src/application/use-cases/seo-growth/GenerateSeoOpportunitiesUseCase';
import {
  CrawlSiteUseCase,
  buildAllowlist,
  isAllowedUrl,
  extractPageFacts,
  SeoPageFetcher,
  SeoPageFetchResult,
  CrawlRunStore,
} from '../../apps/api/src/application/use-cases/seo-growth/CrawlSiteUseCase';
import {
  computeEnvPresence,
  SyncSeoIntegrationStatusesUseCase,
} from '../../apps/api/src/application/use-cases/seo-growth/SyncSeoIntegrationStatusesUseCase';
import { ImportSeoKeywordCsvUseCase } from '../../apps/api/src/application/use-cases/seo-growth/ImportSeoKeywordCsvUseCase';

// ── Opportunity generation ──────────────────────────────────────────────────

const makeDeps = (over: Partial<GenerateSeoOpportunitiesDeps> = {}) => {
  const written: OpportunityWriteInput[] = [];
  const deps: GenerateSeoOpportunitiesDeps = {
    gscRows: async () => [],
    products: async () => [],
    latestCrawlIssuePages: async () => [],
    linkGraphStats: async () => ({ orphanPaths: [] }),
    listOpenOpportunities: async () => [],
    upsertOpportunity: async (o) => { written.push(o); return o; },
    ...over,
  };
  return { deps, written };
};

describe('GenerateSeoOpportunitiesUseCase', () => {
  it('returns honest zeros with a note when gsc_performance is empty', async () => {
    const { deps, written } = makeDeps();
    const result = await new GenerateSeoOpportunitiesUseCase(deps).execute();
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.gscRowsExamined).toBe(0);
    expect(result.countsPerKind).toEqual({});
    expect(result.notes.join(' ')).toMatch(/gsc_performance has no rows/);
    expect(written).toHaveLength(0);
  });

  it('derives ATTRIBUTE_GAP opportunities only from products actually missing content', async () => {
    const { deps, written } = makeDeps({
      products: async () => [
        { id: 'p1', slug: 'phone-a', name: 'Phone A', imageUrl: null, shortDescription: '', specifications: {} },
        { id: 'p2', slug: 'phone-b', name: 'Phone B', imageUrl: 'https://x/img.jpg', shortDescription: 'Fine phone', specifications: { ram: '8GB' } },
      ],
    });
    const result = await new GenerateSeoOpportunitiesUseCase(deps).execute();
    expect(result.countsPerKind.ATTRIBUTE_GAP).toBe(1);
    expect(written).toHaveLength(1);
    expect(written[0].url).toBe('/products/phone-a');
    expect((written[0].evidence as any).missing).toEqual(['imageUrl', 'shortDescription', 'specifications']);
  });

  it('emits GSC CTR and position-band opportunities from real rows', async () => {
    const { deps, written } = makeDeps({
      gscRows: async () => [
        { page: '/products/tv', query: 'buy tv kampala', impressions: 500, clicks: 2, position: 12 },
        { page: '/products/tv', query: 'tv price uganda', impressions: 50, clicks: 5, position: 3 },
      ],
    });
    const result = await new GenerateSeoOpportunitiesUseCase(deps).execute();
    expect(result.countsPerKind.HIGH_IMPRESSION_LOW_CTR).toBe(1);
    expect(result.countsPerKind.STRIKING_DISTANCE_11_20).toBe(1);
    expect(result.countsPerKind.POSITION_2_5).toBe(1);
    expect(written).toHaveLength(3);
  });

  it('dedupes against existing OPEN opportunities by anchor (updates, not duplicates)', async () => {
    const { deps, written } = makeDeps({
      linkGraphStats: async () => ({ orphanPaths: ['/products/orphan'] }),
      listOpenOpportunities: async () => [
        { id: 'existing-1', kind: 'INTERNAL_LINK_GAP', url: '/products/orphan', evidence: { anchor: 'INTERNAL_LINK_GAP|/products/orphan' } },
      ],
    });
    const result = await new GenerateSeoOpportunitiesUseCase(deps).execute();
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(written[0].id).toBe('existing-1');
  });

  it('maps crawl issues to TECHNICAL_ISSUE opportunities', async () => {
    const { deps, written } = makeDeps({
      latestCrawlIssuePages: async () => [
        { url: 'https://www.shopgoldplus.com/x', finalUrl: 'https://www.shopgoldplus.com/x', httpStatus: 200, issues: ['MISSING_TITLE', 'MISSING_H1'] },
        { url: 'https://www.shopgoldplus.com/gone', finalUrl: 'https://www.shopgoldplus.com/gone', httpStatus: 404, issues: ['HTTP_4XX'] },
        { url: 'https://www.shopgoldplus.com/ok', finalUrl: 'https://www.shopgoldplus.com/ok', httpStatus: 200, issues: ['REDIRECT_CHAIN>2'] },
      ],
    });
    const result = await new GenerateSeoOpportunitiesUseCase(deps).execute();
    expect(result.countsPerKind.TECHNICAL_ISSUE).toBe(2); // the redirect-only page is not one of the five technical issues
    expect(written.every((w) => w.kind === 'TECHNICAL_ISSUE')).toBe(true);
  });
});

// ── Crawler SSRF and allowlist ──────────────────────────────────────────────

describe('crawler allowlist (SSRF)', () => {
  const allow = buildAllowlist(null);

  it('accepts only the production hosts by default', () => {
    expect(isAllowedUrl('https://www.shopgoldplus.com/', allow)).toBe(true);
    expect(isAllowedUrl('https://shopgoldplus.com/products/x', allow)).toBe(true);
  });

  it('rejects foreign hosts, IP literals, and non-http(s) schemes', () => {
    expect(isAllowedUrl('https://evil.example.com/', allow)).toBe(false);
    expect(isAllowedUrl('https://169.254.169.254/latest/meta-data', allow)).toBe(false);
    expect(isAllowedUrl('http://127.0.0.1:8080/', allow)).toBe(false);
    expect(isAllowedUrl('https://[::1]/', allow)).toBe(false);
    expect(isAllowedUrl('ftp://www.shopgoldplus.com/', allow)).toBe(false);
    expect(isAllowedUrl('file:///etc/passwd', allow)).toBe(false);
    expect(isAllowedUrl('not a url', allow)).toBe(false);
  });

  it('rejects lookalike subdomain hosts (no suffix matching)', () => {
    expect(isAllowedUrl('https://shopgoldplus.com.evil.com/', allow)).toBe(false);
    expect(isAllowedUrl('https://evil-shopgoldplus.com/', allow)).toBe(false);
  });

  it('admits a single extra staging host but never an IP literal', () => {
    expect(isAllowedUrl('https://staging.example.com/', buildAllowlist('staging.example.com'))).toBe(true);
    expect(isAllowedUrl('https://10.0.0.5/', buildAllowlist('10.0.0.5'))).toBe(false);
  });
});

const makeStore = () => {
  const pages: any[] = [];
  const alerts: any[] = [];
  const finishes: any[] = [];
  let status = 'RUNNING';
  const store: CrawlRunStore = {
    getCrawlRun: async (id) => ({ id, status }),
    insertCrawlPages: async (_run, p) => { pages.push(...p); return p.length; },
    finishCrawlRun: async (_run, outcome) => { finishes.push(outcome); return outcome; },
    replaceLinkGraphForPath: async () => 0,
    raiseAlert: async (a) => { alerts.push(a); return a; },
  };
  return { store, pages, alerts, finishes, setStatus: (s: string) => { status = s; } };
};

const fetcherOf = (responses: Record<string, Partial<SeoPageFetchResult>>): SeoPageFetcher => ({
  fetchPage: async (url) => ({
    status: 200,
    contentType: 'text/html',
    location: null,
    body: '<title>t</title><meta name="description" content="d"><h1>h</h1>',
    responseMs: 5,
    ...(responses[url] ?? {}),
  }),
});

describe('CrawlSiteUseCase', () => {
  const noSleep = async () => {};

  it('refuses a start URL off the allowlist without fetching anything', async () => {
    const { store, pages, finishes } = makeStore();
    let fetched = 0;
    const fetcher: SeoPageFetcher = { fetchPage: async () => { fetched += 1; return { status: 200, contentType: 'text/html', location: null, body: '', responseMs: 1 }; } };
    const outcome = await new CrawlSiteUseCase(store, fetcher, noSleep).execute('run-1', { startUrl: 'https://evil.example.com/' });
    expect(outcome.status).toBe('REFUSED');
    expect(fetched).toBe(0);
    expect(pages).toHaveLength(0);
    expect(finishes[0].status).toBe('FAILED');
  });

  it('stops following a redirect that escapes the allowlist and records the refusal', async () => {
    const { store, pages } = makeStore();
    const fetcher = fetcherOf({
      'https://www.shopgoldplus.com/': { status: 302, location: 'https://evil.example.com/steal', body: null, contentType: null },
    });
    const outcome = await new CrawlSiteUseCase(store, fetcher, noSleep).execute('run-2', {});
    expect(outcome.status).toBe('COMPLETE');
    expect(pages).toHaveLength(1);
    expect(pages[0].issues).toContain('REDIRECT_OFF_ALLOWLIST');
    expect(pages[0].httpStatus).toBe(0);
  });

  it('records on-page issues and raises a CRITICAL alert for noindex on a commercial path', async () => {
    const { store, pages, alerts } = makeStore();
    const fetcher = fetcherOf({
      'https://www.shopgoldplus.com/': {
        body: '<title>Home</title><meta name="description" content="d"><h1>Home</h1><a href="/products/tv">TV</a>',
      },
      'https://www.shopgoldplus.com/products/tv': {
        body: '<meta name="robots" content="noindex,follow">',
      },
    });
    const outcome = await new CrawlSiteUseCase(store, fetcher, noSleep).execute('run-3', {});
    expect(outcome.status).toBe('COMPLETE');
    const tv = pages.find((p) => p.finalUrl.endsWith('/products/tv'));
    expect(tv.issues).toEqual(expect.arrayContaining(['MISSING_TITLE', 'MISSING_META_DESCRIPTION', 'MISSING_H1', 'NOINDEX_COMMERCIAL']));
    expect(alerts.some((a) => a.kind === 'NOINDEX_COMMERCIAL' && a.severity === 'CRITICAL')).toBe(true);
  });

  it('halts between pages when the run has been cancelled', async () => {
    const { store, finishes, setStatus } = makeStore();
    setStatus('CANCELLED');
    const outcome = await new CrawlSiteUseCase(store, fetcherOf({}), noSleep).execute('run-4', {});
    expect(outcome.status).toBe('CANCELLED');
    expect(outcome.pagesCrawled).toBe(0);
    expect(finishes[0].status).toBe('CANCELLED');
  });
});

describe('extractPageFacts', () => {
  it('extracts title, meta, h1, links, JSON-LD types and alt gaps from raw HTML', () => {
    const html = `
      <title> My  Page </title>
      <meta name="description" content="A description">
      <meta name="robots" content="index,follow">
      <link rel="canonical" href="https://www.shopgoldplus.com/x">
      <h1>Heading <b>One</b></h1><h2>a</h2><h2>b</h2>
      <img src="a.jpg" alt="ok"><img src="b.jpg"><img src="c.jpg" alt="">
      <a href="/products/tv">TV</a>
      <a href="https://evil.example.com/">out</a>
      <script type="application/ld+json">{"@type":"Product"}</script>
      <p>Some body text here</p>`;
    const facts = extractPageFacts(html, 'https://www.shopgoldplus.com/', buildAllowlist(null));
    expect(facts.title).toBe('My Page');
    expect(facts.metaDescription).toBe('A description');
    expect(facts.canonical).toBe('https://www.shopgoldplus.com/x');
    expect(facts.h1).toBe('Heading One');
    expect(facts.h2Count).toBe(2);
    expect(facts.imagesMissingAlt).toBe(2);
    expect(facts.internalLinks).toHaveLength(1); // external link excluded
    expect(facts.structuredDataTypes).toEqual(['Product']);
    expect(facts.wordCount).toBeGreaterThan(0);
  });
});

// ── Integration env presence ────────────────────────────────────────────────

describe('integration env presence', () => {
  it('reports CONNECTED only when every expected var is set non-empty', () => {
    expect(computeEnvPresence(['A_KEY', 'B_KEY'], { A_KEY: 'x', B_KEY: 'y' }).computedStatus).toBe('CONNECTED');
    expect(computeEnvPresence(['A_KEY', 'B_KEY'], { A_KEY: 'x', B_KEY: '' }).computedStatus).toBe('READY_FOR_CREDENTIALS');
    expect(computeEnvPresence(['A_KEY'], {}).computedStatus).toBe('READY_FOR_CREDENTIALS');
    expect(computeEnvPresence([], { A_KEY: 'x' }).computedStatus).toBeNull();
  });

  it('never leaks a secret value — only var names and booleans', async () => {
    const secret = 'super-secret-gsc-key-value';
    const env = { GSC_CLIENT_EMAIL: 'svc@x.iam', GSC_PRIVATE_KEY: secret, GSC_SITE_URL: 'https://www.shopgoldplus.com' };
    const updates: any[] = [];
    const store = {
      listIntegrations: async () => [
        { provider: 'GSC', status: 'READY_FOR_CREDENTIALS', config: { envVars: ['GSC_CLIENT_EMAIL', 'GSC_PRIVATE_KEY', 'GSC_SITE_URL'] } },
      ],
      upsertIntegrationStatus: async (provider: string, patch: any) => { updates.push({ provider, patch }); return { provider, status: patch.status ?? 'READY_FOR_CREDENTIALS', config: patch.config ?? {} }; },
    };
    const views = await new SyncSeoIntegrationStatusesUseCase(store, env).execute();
    const gsc = views.find((v) => v.provider === 'GSC')!;
    expect(gsc.computedStatus).toBe('CONNECTED');
    expect(gsc.status).toBe('CONNECTED');
    expect(gsc.envVars).toEqual([
      { name: 'GSC_CLIENT_EMAIL', present: true },
      { name: 'GSC_PRIVATE_KEY', present: true },
      { name: 'GSC_SITE_URL', present: true },
    ]);
    const serialized = JSON.stringify({ views, updates });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('svc@x.iam');
  });

  it('does not overwrite a manual DISABLED status with an env presence check', async () => {
    const updates: any[] = [];
    const store = {
      listIntegrations: async () => Object.keys({}).map(() => null as never) // unused
      ,
      upsertIntegrationStatus: async (provider: string, patch: any) => { updates.push({ provider, patch }); return { provider, status: 'READY_FOR_CREDENTIALS', config: patch.config ?? {} }; },
    };
    const disabledStore = {
      listIntegrations: async () => [
        { provider: 'INDEXNOW', status: 'DISABLED', config: { envVars: ['INDEXNOW_KEY'] } },
      ],
      upsertIntegrationStatus: store.upsertIntegrationStatus,
    };
    const views = await new SyncSeoIntegrationStatusesUseCase(disabledStore, { INDEXNOW_KEY: 'k' }).execute();
    const row = views.find((v) => v.provider === 'INDEXNOW')!;
    expect(row.status).toBe('DISABLED');
    expect(updates.filter((u) => u.provider === 'INDEXNOW' && u.patch.status)).toHaveLength(0);
  });
});

// ── CSV import ──────────────────────────────────────────────────────────────

describe('ImportSeoKeywordCsvUseCase', () => {
  const makeImportStore = () => {
    const queries: any[] = [];
    const imports: any[] = [];
    return {
      store: {
        upsertQuery: async (q: any) => { queries.push(q); return q; },
        recordKeywordImport: async (r: any) => { imports.push(r); return { id: 'imp-1', ...r }; },
      },
      queries,
      imports,
    };
  };

  it('caps imports at 5000 rows', async () => {
    const { store } = makeImportStore();
    const rows = Array.from({ length: 5001 }, (_, i) => ({ query: `q ${i}` }));
    const result = await new ImportSeoKeywordCsvUseCase(store).execute({ provider: 'KW_TOOL', rows });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TOO_MANY_ROWS');
  });

  it('validates, normalizes, dedupes and records one import row', async () => {
    const { store, queries, imports } = makeImportStore();
    const result = await new ImportSeoKeywordCsvUseCase(store).execute({
      provider: 'KW_TOOL',
      rows: [
        { query: '  Buy   TV Kampala ', intent: 'transactional', volume: 320, difficulty: 40 },
        { query: 'buy tv kampala' }, // duplicate after normalization
        { query: '' }, // invalid
        { query: 'ps5 price uganda', volume: -3, difficulty: 300 }, // bad numbers dropped, query kept
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.imported).toBe(2);
      expect(result.skipped).toHaveLength(2);
      expect(result.importId).toBe('imp-1');
    }
    expect(queries[0].normalizedQuery).toBe('buy tv kampala');
    expect(queries[0].intent).toBe('TRANSACTIONAL');
    expect(queries[0].volumeSource).toBe('KW_TOOL');
    expect(queries[1].volume).toBeNull();
    expect(queries[1].difficulty).toBeNull();
    expect(imports[0].rowCount).toBe(2);
  });
});
