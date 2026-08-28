import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { likeContains } from '../../apps/api/src/infrastructure/db/like';
import { csvCell } from '../../apps/api/src/interfaces/http/csv';
import { sniffImageMime } from '../../apps/api/src/application/use-cases/media/MediaLibraryUseCase';
import { salePriceUgx } from '../../apps/web/src/lib/storefrontDiscount';

/** Second sweep (the 17 subsystems the first audit never reached), fixes pinned. */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('search text is data, not a pattern', () => {
  it('escapes LIKE wildcards', () => {
    expect(likeContains('50%')).toBe('%50\\%%');
    expect(likeContains('10_000')).toBe('%10\\_000%');
    expect(likeContains('a\\b')).toBe('%a\\\\b%');
  });

  for (const repo of [
    'DrizzleBatteryCatalogueRepository', 'DrizzleDeviceCatalogueRepository', 'DrizzleProductRepository',
    'DrizzleRecommendationRuleRepository', 'DrizzleMediaLibraryRepository',
  ]) {
    it(`${repo} builds its needle through likeContains`, () => {
      const src = read(`apps/api/src/infrastructure/db/repositories/${repo}.ts`);
      expect(src).toMatch(/likeContains\(/);
      expect(src).not.toMatch(/`%\$\{[^}]+\}%`/);
    });
  }
});

describe('exports cannot smuggle a formula', () => {
  it('prefixes formula-leading cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('plain')).toBe('"plain"');
  });

  for (const route of ['loyalty', 'delivery', 'pim-imports']) {
    it(`${route} export uses the one helper`, () => {
      const src = read(`apps/api/src/interfaces/http/routes/admin/${route}.ts`);
      expect(src).toMatch(/csvCell\(/);
      expect(src).not.toMatch(/const esc(ape)? = \(v: unknown\)/);
    });
  }
});

describe('uploads are typed by their bytes', () => {
  it('recognises the allowed image formats and nothing else', () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/png');
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });

  it('the use case ignores the client-declared MIME', () => {
    const src = read('apps/api/src/application/use-cases/media/MediaLibraryUseCase.ts');
    expect(src).toMatch(/const sniffed = sniffImageMime\(file\.buffer\);/);
    expect(src).not.toMatch(/if \(!ALLOWED_MIME\.has\(file\.mime\)\)/);
  });
});

describe('bounded inputs and bounded waits', () => {
  it('the public recently-viewed limit is capped', () => {
    expect(read('apps/api/src/application/recommendations/GetRecentlyViewedUseCase.ts')).toMatch(/Math\.min\(Number\.isInteger\(input\.limit\)/);
  });

  for (const f of ['seo/IndexNowClient', 'seo/GscClient', 'seo/adapters/GoogleServiceAccountAuth', 'activation/DefaultControlledLiveCanaryTransport']) {
    it(`${f} never waits on a provider forever`, () => {
      const src = read(`apps/api/src/infrastructure/${f}.ts`);
      const fetches = src.match(/await fetch\(/g)?.length ?? 0;
      const signals = src.match(/signal: AbortSignal\.timeout\(/g)?.length ?? 0;
      expect(signals).toBe(fetches);
    });
  }
});

describe('telemetry respects a withdrawn analytics consent', () => {
  it('asks the consent state before enriching or queueing, and records the block', () => {
    const src = read('apps/api/src/application/use-cases/telemetry/TrackBrowserTelemetryEventUseCase.ts');
    const gate = src.indexOf('consentRepo');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(src.indexOf('identityRepo\n'));
    expect(gate).toBeLessThan(src.indexOf('.insert(outboxEvents)'));
    expect(src).toMatch(/consent\.analyticsGranted === false/);
    expect(src).toMatch(/action: 'CONSENT_BLOCKED'/);
  });

  it('telemetry dispatch refuses to sign with a default secret', () => {
    const src = read('apps/api/src/infrastructure/telemetry/TelemetryDispatchService.ts');
    expect(src).not.toMatch(/gtm-default-secret/);
    expect(src).toMatch(/GTM_NOT_CONFIGURED/);
  });

  it('order pages are excluded from the PWA cache and from crawlers', () => {
    expect(read('apps/web/public/sw.js')).toMatch(/'\/orders',\s*\n\s*'\/track-order',/);
    expect(read('apps/web/src/pages/robots.txt.ts')).toMatch(/Disallow: \/orders/);
  });
});

describe('the 125 Drizzle repositories', () => {
  const readRepo = (f: string) =>
    readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/db/repositories', f), 'utf8');

  it('a redemption settles once, so spent points are never handed back twice', () => {
    const src = readRepo('DrizzleLoyaltyCompletionRepository.ts');
    expect(src).toMatch(/reversed: \['reserved', 'applied'\]/);
    expect(src).toMatch(/inArray\(loyaltyRedemptions\.status, PRIOR_STATES\[status\]\)/);
  });

  it('renaming a brand renames its devices in the same transaction', () => {
    const src = readRepo('DrizzleDeviceCatalogueRepository.ts');
    const body = src.slice(src.indexOf('async updateBrand'), src.indexOf('async setBrandStatus'));
    expect(body).toMatch(/db\.transaction/);
    expect(body).not.toMatch(/await db\.update\(devices\)/);
  });
});

describe('what production actually receives', () => {
  it('the PesaPal provider callback override reaches the container', () => {
    const compose = readFileSync(resolve(__dirname, '../../docker-compose.production.yml'), 'utf8');
    expect(compose).toMatch(/PESAPAL_PROVIDER_CALLBACK_URL=\$\{PESAPAL_PROVIDER_CALLBACK_URL:-\}/);
  });
});

describe('the browse rail advertises what the basket charges', () => {
  const rail = () =>
    readFileSync(resolve(__dirname, '../../apps/web/src/components/recommendations/RecentlyViewedRail.astro'), 'utf8');

  it('stamps the campaign floor alongside the percentage', () => {
    expect(rail()).toMatch(/data-sale-floor=\{railDiscount\.active \? String\(railDiscount\.priceFloorUgx\) : ""\}/);
  });

  it('prices through the one shared helper, floor included', () => {
    const src = rail();
    expect(src).toMatch(/import \{ salePriceUgx \} from "\.\.\/\.\.\/lib\/storefrontDiscount"/);
    expect(src).toMatch(/salePriceUgx\(regular, saleBps, saleFloor\)/);
    // The unfloored formula this replaced must not come back.
    expect(src).not.toMatch(/regular - Math\.floor\(\(regular \* saleBps\)/);
  });

  it('calls it a sale only when the price actually drops', () => {
    expect(rail()).toMatch(/const onSale = saleActive && hasPrice && salePriceOf\(item\.price\) < item\.price;/);
  });

  it('the shared helper stops the cut at the floor', () => {
    expect(salePriceUgx(155_000, 1000, 145_000)).toBe(145_000);
    expect(salePriceUgx(200_000, 1000, 145_000)).toBe(180_000);
  });
});
