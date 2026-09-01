import { describe, it, expect } from 'vitest';
import {
  buildMerchantFeedXml,
  escapeXml,
  isFeedIncluded,
  FeedQualityUseCase,
  type FeedProduct,
} from '../../apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase';
import {
  SubmitIndexNowUseCase,
  isAllowedIndexNowUrl,
} from '../../apps/api/src/application/use-cases/seo-growth/SubmitIndexNowUseCase';
import {
  SyncGscPerformanceUseCase,
  type GscPerformanceUpsertRow,
} from '../../apps/api/src/application/use-cases/seo-growth/SyncGscPerformanceUseCase';
import { SEO_INTEGRATION_ENV_VARS } from '../../apps/api/src/application/use-cases/seo-growth/SyncSeoIntegrationStatusesUseCase';

const product = (over: Partial<FeedProduct> = {}): FeedProduct => ({
  sku: 'GP-100',
  slug: 'solar-panel-100w',
  name: 'Solar Charger 100W',
  shortDescription: 'A durable 100W monocrystalline solar panel for home and business use in Uganda.',
  priceUgx: 350_000,
  stockStatus: 'in_stock',
  imageUrl: 'https://cdn.shopgoldplus.com/p/gp-100.jpg',
  modelNumber: 'SP-100M',
  isFeedEligible: true,
  active: true,
  approvalStatus: 'approved',
  // A complete listing: the diagnostics also want a Google category (the name
  // decides), a written long description and a second image.
  categoryName: 'Power Devices',
  subcategory: 'Solar',
  longDescription: 'A durable 100W monocrystalline solar panel for home and business use in Uganda, with a 25-year output warranty.',
  imageUrls: ['https://cdn.shopgoldplus.com/p/gp-100.jpg', 'https://cdn.shopgoldplus.com/p/gp-100-2.jpg'],
  ...over,
});

describe('Merchant feed XML', () => {
  it('escapes XML special characters everywhere', () => {
    const xml = buildMerchantFeedXml([
      product({ name: 'Cable 2.5mm² <Copper> & "Earth"', shortDescription: `It's <b>good</b> & long enough to describe usage clearly.`, longDescription: '' }),
    ]);
    expect(xml).toContain('Cable 2.5mm² &lt;Copper&gt; &amp; &quot;Earth&quot;');
    expect(xml).toContain('It&apos;s &lt;b&gt;good&lt;/b&gt; &amp;');
    expect(xml).not.toContain('<Copper>');
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('excludes ineligible, imageless, priceless, inactive and unapproved products', () => {
    const xml = buildMerchantFeedXml([
      product(),
      product({ sku: 'NOIMG', imageUrl: null }),
      product({ sku: 'NOPRICE', priceUgx: 0 }),
      product({ sku: 'NOTELIG', isFeedEligible: false }),
      product({ sku: 'INACTIVE', active: false }),
      product({ sku: 'DRAFT', approvalStatus: 'draft' }),
    ]);
    expect(xml).toContain('<g:id>GP-100</g:id>');
    for (const sku of ['NOIMG', 'NOPRICE', 'NOTELIG', 'INACTIVE', 'DRAFT']) {
      expect(xml).not.toContain(`<g:id>${sku}</g:id>`);
    }
    expect(isFeedIncluded(product({ imageUrl: '  ' }))).toBe(false);
  });

  it('never emits g:gtin, includes house brand, price in UGX, mpn only when present', () => {
    const xml = buildMerchantFeedXml([product(), product({ sku: 'GP-200', slug: 's2', modelNumber: null })]);
    expect(xml).not.toContain('g:gtin');
    expect(xml).toContain('<g:brand>GoldPlus</g:brand>');
    expect(xml).toContain('<g:price>350000 UGX</g:price>');
    expect(xml).toContain('<g:mpn>SP-100M</g:mpn>');
    expect(xml).toContain('<g:availability>in stock</g:availability>');
    expect(xml).toContain('<link>https://shopgoldplus.com/products/solar-panel-100w</link>');
    // exactly one mpn (the null-model product must not get one)
    expect(xml.match(/<g:mpn>/g)?.length).toBe(1);
  });

  it('maps non-in_stock statuses to "out of stock"', () => {
    const xml = buildMerchantFeedXml([product({ stockStatus: 'out_of_stock' })]);
    expect(xml).toContain('<g:availability>out of stock</g:availability>');
  });
});

describe('FeedQualityUseCase', () => {
  it('reports real per-product diagnostics with counts', async () => {
    const uc = new FeedQualityUseCase(async () => [
      product(),
      product({ sku: 'BAD', imageUrl: null, priceUgx: 0, shortDescription: 'too short', modelNumber: '', name: 'X'.repeat(151) }),
    ]);
    const report = await uc.execute();
    expect(report.totalProducts).toBe(2);
    expect(report.includedInFeed).toBe(1);
    expect(report.excludedFromFeed).toBe(1);
    const bad = report.products.find((p) => p.sku === 'BAD')!;
    expect(bad.included).toBe(false);
    expect(bad.issues).toEqual(
      expect.arrayContaining(['missing_image', 'missing_price', 'description_under_50_chars', 'missing_mpn', 'title_over_150_chars']),
    );
    expect(report.issueCounts.missing_image).toBe(1);
    const good = report.products.find((p) => p.sku === 'GP-100')!;
    expect(good.issues).toEqual([]);
  });
});

describe('SubmitIndexNowUseCase', () => {
  const submitter = () => {
    const calls: any[] = [];
    return {
      calls,
      submit: async (payload: any) => {
        calls.push(payload);
        return { status: 200 };
      },
    };
  };

  it('is an honest no-op without INDEXNOW_KEY', async () => {
    const s = submitter();
    const uc = new SubmitIndexNowUseCase(s, {});
    const result = await uc.execute(['https://shopgoldplus.com/products/a']);
    expect(result).toEqual({ status: 'READY_FOR_CREDENTIALS' });
    expect(s.calls).toHaveLength(0);
  });

  it('rejects URLs not on shopgoldplus.com and non-https URLs', async () => {
    const s = submitter();
    const uc = new SubmitIndexNowUseCase(s, { INDEXNOW_KEY: 'abcdef1234' });
    const result = await uc.execute(['https://shopgoldplus.com/x', 'https://evil.com/x']);
    expect(result.status).toBe('REJECTED');
    expect(s.calls).toHaveLength(0);
    expect(isAllowedIndexNowUrl('http://shopgoldplus.com/x')).toBe(false);
    expect(isAllowedIndexNowUrl('https://www.shopgoldplus.com/x')).toBe(true);
    expect(isAllowedIndexNowUrl('https://shopgoldplus.com.evil.com/x')).toBe(false);
    expect(isAllowedIndexNowUrl('not a url')).toBe(false);
  });

  it('submits deduplicated URLs capped at 100 with key + keyLocation', async () => {
    const s = submitter();
    const uc = new SubmitIndexNowUseCase(s, { INDEXNOW_KEY: 'abcdef1234' });
    const urls = Array.from({ length: 150 }, (_, i) => `https://shopgoldplus.com/products/p${i}`);
    const result = await uc.execute([...urls, urls[0]]);
    expect(result.status).toBe('SUBMITTED');
    expect(s.calls[0].urlList).toHaveLength(100);
    expect(s.calls[0].host).toBe('shopgoldplus.com');
    expect(s.calls[0].key).toBe('abcdef1234');
    expect(s.calls[0].keyLocation).toBe('https://shopgoldplus.com/abcdef1234.txt');
  });
});

describe('SyncGscPerformanceUseCase', () => {
  const fakeStore = (syncState: Record<string, unknown> | null = null) => {
    const upserted: GscPerformanceUpsertRow[][] = [];
    const patches: any[] = [];
    return {
      upserted,
      patches,
      getIntegration: async () => (syncState ? { sync_state: syncState } : null),
      upsertIntegrationStatus: async (_p: string, patch: any) => {
        patches.push(patch);
        return {};
      },
      upsertGscPerformance: async (rows: GscPerformanceUpsertRow[]) => {
        upserted.push(rows);
        return rows.length;
      },
    };
  };

  it('returns READY_FOR_CREDENTIALS without a client and touches nothing', async () => {
    const store = fakeStore();
    const uc = new SyncGscPerformanceUseCase({ client: null, store });
    expect(await uc.execute()).toEqual({ status: 'READY_FOR_CREDENTIALS' });
    expect(store.upserted).toHaveLength(0);
    expect(store.patches).toHaveLength(0);
  });

  it('re-reads the maturing window as well as the new days, upserting mapped rows', async () => {
    const store = fakeStore({ lastSyncedDate: '2026-08-01' });
    const queries: any[] = [];
    const client = {
      query: async (input: any) => {
        queries.push(input);
        return {
          rows: [
            { keys: ['2026-08-02', 'https://shopgoldplus.com/products/a', 'solar panel uganda'], clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 },
          ],
        };
      },
    };
    const uc = new SyncGscPerformanceUseCase({
      client,
      store,
      now: () => new Date('2026-08-08T12:00:00Z'),
      sleep: async () => {},
    });
    const result = await uc.execute();
    expect(result.status).toBe('SYNCED');
    // Search Console REVISES a day's figures for several days after first
    // reporting it. Resuming at lastSyncedDate + 1 (2026-08-02) froze every row
    // at its earliest, lowest value and never went back. The window now always
    // reaches REFRESH_WINDOW_DAYS back from the end date, so those days are
    // re-read and upserted with Google's corrected numbers.
    expect(queries[0].startDate).toBe('2026-07-30'); // endDate − 7
    expect(queries[0].endDate).toBe('2026-08-06'); // today − 2 days
    expect(store.upserted[0][0]).toMatchObject({
      date: '2026-08-02',
      page: 'https://shopgoldplus.com/products/a',
      query: 'solar panel uganda',
      clicks: 3,
      impressions: 40,
    });
    const final = store.patches.at(-1);
    expect(final.status).toBe('CONNECTED');
    expect(final.syncState).toMatchObject({ lastSyncedDate: '2026-08-06' });
  });

  it('pages with startRow when a full page (rowLimit) comes back', async () => {
    const store = fakeStore({ lastSyncedDate: '2026-08-04' });
    const startRows: number[] = [];
    const full = Array.from({ length: 25_000 }, (_, i) => ({
      keys: ['2026-08-05', `https://shopgoldplus.com/p${i}`, `q${i}`], clicks: 1, impressions: 2, ctr: 0.5, position: 1,
    }));
    let call = 0;
    const client = {
      query: async (input: any) => {
        startRows.push(input.startRow);
        call += 1;
        return call === 1 ? { rows: full } : { rows: full.slice(0, 10) };
      },
    };
    const uc = new SyncGscPerformanceUseCase({ client, store, now: () => new Date('2026-08-08T12:00:00Z'), sleep: async () => {} });
    const result = await uc.execute();
    expect(result).toMatchObject({ status: 'SYNCED', rowsUpserted: 25_010 });
    expect(startRows).toEqual([0, 25_000]);
  });

  it('retries 429s with backoff then records failure honestly after max retries', async () => {
    const store = fakeStore({ lastSyncedDate: '2026-08-04' });
    let attempts = 0;
    const sleeps: number[] = [];
    const client = {
      query: async () => {
        attempts += 1;
        const err: any = new Error('quota');
        err.status = 429;
        throw err;
      },
    };
    const uc = new SyncGscPerformanceUseCase({
      client, store,
      now: () => new Date('2026-08-08T12:00:00Z'),
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const result = await uc.execute();
    expect(result.status).toBe('FAILED');
    expect(attempts).toBe(4); // initial + 3 retries
    expect(sleeps).toEqual([1000, 2000, 4000]); // exponential
    const final = store.patches.at(-1);
    expect(final.status).toBe('ERROR');
    expect(final.lastError).toContain('quota');
    expect(final.lastFailureAt).toBeInstanceOf(Date);
  });

  it('backfills up to 16 months in date chunks on first run', async () => {
    const store = fakeStore(null);
    const chunks: Array<{ startDate: string; endDate: string }> = [];
    const client = {
      query: async (input: any) => {
        chunks.push({ startDate: input.startDate, endDate: input.endDate });
        return { rows: [] };
      },
    };
    const uc = new SyncGscPerformanceUseCase({ client, store, now: () => new Date('2026-08-08T12:00:00Z'), sleep: async () => {} });
    const result = await uc.execute();
    expect(result.status).toBe('SYNCED');
    expect(chunks[0].startDate).toBe('2025-04-08'); // 16 months back
    expect(chunks.at(-1)!.endDate).toBe('2026-08-06');
    expect(chunks.length).toBeGreaterThan(10); // ~16 chunks of ≤31 days
    // chunks are contiguous and non-overlapping
    for (let i = 1; i < chunks.length; i += 1) {
      expect(new Date(chunks[i].startDate).getTime() - new Date(chunks[i - 1].endDate).getTime()).toBe(24 * 3600 * 1000);
    }
  });
});

describe('integration env-var declarations', () => {
  it('GSC list matches what the connector consumes', () => {
    expect(SEO_INTEGRATION_ENV_VARS.GSC).toEqual(['GSC_SERVICE_ACCOUNT_JSON', 'GSC_SITE_URL']);
  });
  it('INDEXNOW list matches what the connector consumes', () => {
    expect(SEO_INTEGRATION_ENV_VARS.INDEXNOW).toEqual(['INDEXNOW_KEY']);
  });
});
