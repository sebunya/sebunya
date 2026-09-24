import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancellationRefundEvent,
  ga4PurchaseInFlight,
  retryIsSafeAfterUnknown,
  toCanonical,
} from '../../apps/api/src/infrastructure/measurement/DeliveryService';
import { isStoredAdvertisingRefusal } from '../../apps/api/src/infrastructure/measurement/AdvertisingConsentGate';
import { isDeclaredAutomationUa } from '../../apps/api/src/application/use-cases/telemetry/DeclaredAutomation';
import { classifyChannel } from '../../apps/api/src/domain/measurement/Channels';
import { ConsentService } from '../../apps/api/src/application/use-cases/measurement/ConsentService';
import { GetCustomerPreferenceCentreUseCase } from '../../apps/api/src/application/use-cases/preferences/GetCustomerPreferenceCentreUseCase';
import { fitColumn, RECOMMENDATION_EVENT_TEXT_WIDTHS } from '../../apps/api/src/infrastructure/db/repositories/RecommendationEventColumnWidths';
import { GetRecommendationsUseCase } from '../../apps/api/src/application/recommendations/GetRecommendationsUseCase';
import { GetRecentlyViewedUseCase } from '../../apps/api/src/application/recommendations/GetRecentlyViewedUseCase';
import { ProductSignalExtractor } from '../../apps/api/src/application/recommendations/ProductSignalExtractor';
import { RecommendationScoringService } from '../../apps/api/src/application/recommendations/RecommendationScoringService';
import { CompatibilityRuleService } from '../../apps/api/src/application/recommendations/CompatibilityRuleService';
import { TrendingScoreService } from '../../apps/api/src/application/recommendations/TrendingScoreService';
import { RecommendationEligibilityService } from '../../apps/api/src/application/recommendations/RecommendationEligibilityService';
import { RecommendationDeduplicationService } from '../../apps/api/src/application/recommendations/RecommendationDeduplicationService';
import { RecommendationDiversityService } from '../../apps/api/src/application/recommendations/RecommendationDiversityService';
import { RecommendationRuleApplicationService } from '../../apps/api/src/application/recommendations/RecommendationRuleApplicationService';
import { RecommendationRuleConflictService } from '../../apps/api/src/application/recommendations/RecommendationRuleConflictService';
import { AssignRecommendationExperimentUseCase } from '../../apps/api/src/application/recommendations/AssignRecommendationExperimentUseCase';
import { ExperimentOperationsUseCase } from '../../apps/api/src/application/use-cases/experiments/ExperimentOperationsUseCase';
import {
  buildMerchantFeedXml,
  escapeXml,
  isFeedIncluded,
  FeedQualityUseCase,
  type FeedProduct,
} from '../../apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase';
import { BullMqPurchaseMeasurementQueue } from '../../apps/api/src/infrastructure/measurement/BullMqPurchaseMeasurementQueue';
import { RetryPaymentMeasurementReconciliationUseCase } from '../../apps/api/src/application/use-cases/measurement/RetryPaymentMeasurementReconciliationUseCase';
import { ReplayMeasurementDlqUseCase } from '../../apps/api/src/application/use-cases/measurement/ReplayMeasurementDlqUseCase';
import { reconciliationPage } from '../../apps/api/src/infrastructure/measurement/DrizzlePaymentMeasurementRepository';
import { RequestQuoteUseCase } from '../../apps/api/src/application/use-cases/governance/RequestQuoteUseCase';
import { ReportFakeProductUseCase } from '../../apps/api/src/application/use-cases/governance/ReportFakeProductUseCase';
import { DealerApplicationUseCase } from '../../apps/api/src/application/use-cases/DealerApplicationUseCase';
import { isInternalReferrerHost } from '../../apps/web/src/lib/internalReferrer';
import { visitorCookieDomain } from '../../apps/web/src/lib/visitorCookieDomain';
import { categoryHasUniqueCopy } from '../../apps/web/src/lib/crawlPolicy';
import { STATIC_SITEMAP_PATHS } from '../../apps/web/src/lib/sitemap';
import { LEGAL_POLICIES, policyBySlug } from '../../apps/web/src/lib/legal-policies';

/**
 * Batch 3 (storefront, SEO, measurement), 2026-09-24. One test per behaviour
 * fixed; source-level assertions only where the behaviour lives in a page or
 * an SQL statement a unit test cannot execute.
 */

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

// ─── Admin, storefront, SEO ─────────────────────────────────────────────────

describe('the header editor no longer saves fields the header never reads', () => {
  const nav = code('apps/web/src/pages/admin/nav.astro');
  it('writes no featured-card text, cutoffTimeLabel or noteFinalHours', () => {
    expect(nav).not.toMatch(/feat\.\$\{/);
    expect(nav).not.toMatch(/setFeat|featPanels/);
    expect(nav).not.toMatch(/'settings\.cutoffTimeLabel'|'flash\.noteFinalHours'/);
  });
  it('says where the cards and the cutoff really come from', () => {
    expect(nav).toMatch(/picked automatically from photographed,\s+in-stock products/);
    expect(nav).toMatch(/href="\/admin\/business-info"/);
  });
});

describe('the service worker never keeps a signed-in snapshot', () => {
  it('is covered by ServiceWorkerInstalls.test.ts (anonymous precache, v5, no / or /shop)', () => {
    const sw = read('apps/web/public/sw.js');
    expect(sw).toMatch(/credentials: 'omit'/);
  });
});

describe('policy versions move when the policy does', () => {
  it('returns, privacy and cookies carry their material-change versions and dates', () => {
    expect(policyBySlug('returns')).toMatchObject({ version: '1.1', effectiveDate: '2026-09-01' });
    expect(policyBySlug('privacy')).toMatchObject({ version: '1.1', effectiveDate: '2026-09-19' });
    expect(policyBySlug('cookies')).toMatchObject({ version: '1.1', effectiveDate: '2026-09-19' });
    expect(policyBySlug('terms')).toMatchObject({ version: '1.0', effectiveDate: '2026-08-13' });
    expect(policyBySlug('warranty')).toMatchObject({ version: '1.0', effectiveDate: '2026-08-13' });
  });
  it('the cookies summary no longer says first-party only', () => {
    expect(policyBySlug('cookies')!.summary).not.toMatch(/first-party cookies/);
  });
});

describe('meta descriptions', () => {
  it('the homepage states what the shop is, with no site-default fallback', () => {
    const home = read('apps/web/src/pages/index.astro');
    expect(home).toMatch(/<BaseLayout title="Premium electronics in Uganda" description="Phone accessories, power banks and phone batteries from our Kampala shop\. Same-day delivery in Kampala and Wakiso\."/);
    // Emitted three times (description, og, twitter) on the home budget.
    const description = home.match(/<BaseLayout title="[^"]*" description="([^"]*)"/)![1];
    expect(description.length).toBeLessThanOrEqual(120);
  });
  it('each legal page uses the published CMS SEO fields, else its registry summary', () => {
    for (const p of LEGAL_POLICIES) {
      const src = read(`apps/web/src/pages/${p.slug}.astro`);
      expect(src, p.slug).toMatch(/title=\{cms\?\.seoTitle \|\| '[^']+'\} description=\{cms\?\.seoDescription \|\| policy\.summary\}/);
    }
  });
  it('/cookies has one main landmark (the layout\'s)', () => {
    expect(code('apps/web/src/pages/cookies.astro')).not.toMatch(/<main\b/);
  });
});

describe('Organization / Store JSON-LD', () => {
  const src = read('apps/web/src/components/SiteJsonLd.astro');
  it('uses the 512 px square logo, never the 150 x 43 banner', () => {
    expect(src).toContain('const LOGO = `${SITE_ORIGIN}/icon-512.png`;');
    expect(src).not.toContain('150x43');
  });
  it('ties ShopGoldPlus and GoldPlus together and no longer calls directions a description', () => {
    expect(src.match(/alternateName: 'GoldPlus'/g)).toHaveLength(2);
    expect(src).not.toMatch(/store\.description = biz\.addressLine2/);
  });
});

describe('sitemaps submit only indexable URLs', () => {
  it('a category is indexable only with an operator description (the shop and the sitemap share the rule)', () => {
    expect(categoryHasUniqueCopy({ description: 'Chargers we test ourselves.' })).toBe(true);
    expect(categoryHasUniqueCopy({ description: '   ' })).toBe(false);
    expect(categoryHasUniqueCopy({})).toBe(false);
    expect(read('apps/web/src/pages/sitemaps/categories.xml.ts')).toContain('.filter(categoryHasUniqueCopy)');
    expect(read('apps/web/src/pages/shop.astro')).toContain('categoryHasUniqueCopy(selectedCategory)');
  });
  it('lists the indexable policy pages that were missing', () => {
    expect(STATIC_SITEMAP_PATHS).toContain('/cookies');
    expect(STATIC_SITEMAP_PATHS).toContain('/loyalty-terms');
  });
});

describe('a blog outage is not "nothing published"', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetchPublishedPosts flags an error and never an empty success', async () => {
    const { fetchPublishedPosts } = await import('../../apps/web/src/lib/blog');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 502 })));
    expect(await fetchPublishedPosts()).toEqual({ posts: [], total: 0, error: true });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    expect((await fetchPublishedPosts()).error).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: { posts: [], total: 0 } }), { status: 200 })));
    expect(await fetchPublishedPosts()).toEqual({ posts: [], total: 0 });
  });

  it('the index answers 503 (not noindex) and the sitemap answers 503 (not an empty urlset) on error', () => {
    const index = read('apps/web/src/pages/blog/index.astro');
    expect(index).toMatch(/if \(unavailable\) \{\s*Astro\.response\.status = 503;/);
    expect(index).toContain('const empty = !unavailable && posts.length === 0;');
    const sitemap = read('apps/web/src/pages/sitemaps/blog.xml.ts');
    expect(sitemap).toMatch(/if \(error\) \{\s*return new Response\([^)]*\{\s*status: 503/);
  });
});

describe('storefront details', () => {
  it('the cart rail updates its noun with its number', () => {
    const rail = read('apps/web/src/components/home/CartAwareRail.astro');
    expect(rail).toContain('<span data-cart-count-suffix>');
    expect(rail).toMatch(/suffix\.textContent = totalCount === 1 \? "item" : "items"/);
  });
  it('screen readers hear the sale price the card shows', () => {
    const card = read('apps/web/src/components/recommendations/RecommendationCard.astro');
    expect(card).toMatch(/const spokenPrice = saleUgx !== null \? `\$\{formatUgx\(saleUgx\)\}, reduced from \$\{formattedPrice\}` : formattedPrice;/);
    expect(card).toContain('aria-label={`View ${item.name}. ${spokenPrice}. ${availabilityLabel}.`}');
    const recent = read('apps/web/src/components/recommendations/RecentlyViewedRail.astro');
    expect(recent).toContain('aria-label="View ${escapedName}. ${spokenPrice}. ${availabilityLabel}."');
  });
  it('the privacy page\'s ad-recipient lookup is bounded', () => {
    expect(read('apps/web/src/lib/adRecipients.ts')).toContain('signal: AbortSignal.timeout(3000)');
  });
});

// ─── Measurement ────────────────────────────────────────────────────────────

describe('GA4 refund for a cancelled order carries the order value', () => {
  const confirmed = { orderNumber: 'GP-1001', netMerchandiseUGX: 440_000, collectedDeliveryUGX: 10_000, taxUGX: 0, items: [] };
  const cancel = { event_id: 'c-1', event_name: 'order_cancelled', occurred_at: '2026-09-24T10:00:00Z', payload: { orderId: 'o1', orderNumber: 'GP-1001', fromStatus: 'confirmed', toStatus: 'cancelled' } };

  it('the old path sent value 0', () => {
    expect(toCanonical(cancel, 'ga4:refund', {}).ecommerce!.value).toBe(0);
  });
  it('with the confirmed totals, the refund equals the purchase value; ids stay the cancellation\'s', () => {
    const merged = cancellationRefundEvent(cancel, confirmed)!;
    const refund = toCanonical(merged, 'ga4:refund', {});
    expect(refund.ecommerce).toMatchObject({ transaction_id: 'GP-1001', value: 450_000, currency: 'UGX' });
    expect(refund.event_id).toBe('c-1');
    expect(refund.event_name).toBe('refund');
  });
  it('no confirmation = no refund event at all (never a refund of 0)', () => {
    expect(cancellationRefundEvent(cancel, null)).toBeNull();
    expect(read('apps/api/src/infrastructure/measurement/DeliveryService.ts')).toContain("'NO_CONFIRMED_VALUE'");
  });
});

describe('a cancellation waits for an in-flight purchase; refunds are never blindly re-sent', () => {
  it('in flight: LEASED, UNKNOWN_OUTCOME, or RETRY_WAIT after an attempt', () => {
    expect(ga4PurchaseInFlight({ state: 'LEASED', attempt_count: 0 })).toBe(true);
    expect(ga4PurchaseInFlight({ state: 'UNKNOWN_OUTCOME', attempt_count: 1 })).toBe(true);
    expect(ga4PurchaseInFlight({ state: 'RETRY_WAIT', attempt_count: 2 })).toBe(true);
    expect(ga4PurchaseInFlight({ state: 'RETRY_WAIT', attempt_count: 0 })).toBe(false);
    expect(ga4PurchaseInFlight({ state: 'PENDING', attempt_count: 0 })).toBe(false);
    expect(ga4PurchaseInFlight({ state: 'ACCEPTED', attempt_count: 1 })).toBe(false);
    expect(ga4PurchaseInFlight(undefined)).toBe(false);
  });
  it('the router throws PURCHASE_IN_FLIGHT before it cancels anything', () => {
    const src = read('apps/api/src/infrastructure/measurement/DeliveryService.ts');
    expect(src.indexOf("throw new Error('PURCHASE_IN_FLIGHT')")).toBeGreaterThan(-1);
    expect(src.indexOf("throw new Error('PURCHASE_IN_FLIGHT')")).toBeLessThan(src.indexOf("state_reason = 'ORDER_CANCELLED'"));
  });
  it('a GA4 refund with an unknown outcome is quarantined, a purchase still retries', () => {
    expect(retryIsSafeAfterUnknown('ga4:refund')).toBe(false);
    expect(retryIsSafeAfterUnknown('ga4:purchase')).toBe(true);
  });
  it('a failed ad-destination read no longer routes a sale without its ad conversions', () => {
    const src = read('apps/api/src/infrastructure/measurement/DeliveryService.ts');
    expect(src).toContain('const live = await adRepo.active();');
    expect(src).not.toContain('adRepo.active().catch(() => [])');
  });
});

describe('an advertising refusal is honoured on every ad path, and never lapses', () => {
  it('the one predicate: explicit false with a real grant type; no expiry clause', () => {
    expect(isStoredAdvertisingRefusal({ advertising_granted: false, last_grant_type: 'withdrawn' })).toBe(true);
    expect(isStoredAdvertisingRefusal({ advertising_granted: false, last_grant_type: 'explicit', expires_at: '2020-01-01' } as never)).toBe(true);
    expect(isStoredAdvertisingRefusal({ advertising_granted: false, last_grant_type: 'unknown' })).toBe(false);
    expect(isStoredAdvertisingRefusal({ advertising_granted: true, last_grant_type: 'explicit' })).toBe(false);
    expect(isStoredAdvertisingRefusal(undefined)).toBe(false);
  });
  it('purchases and browsing conversions both use it, and defer when it cannot be read', () => {
    const delivery = read('apps/api/src/infrastructure/measurement/DeliveryService.ts');
    expect(delivery).toContain('await advertisingRefused({ userId: identity.user_id, fpClientId: identity.fp_client_id })');
    expect(delivery).toContain("'CONSENT_LOOKUP_FAILED'");
    expect(delivery).not.toMatch(/expires_at\) < new Date\(\)/);
    const ads = read('apps/api/src/infrastructure/advertising/AdConversionDispatch.ts');
    expect(ads).toContain('refused = await advertisingRefused(');
    expect(ads).toContain("await finish('suppressed', { lastError: 'CONSENT_DENIED' })");
    expect(ads).toContain("lastError: 'CONSENT_LOOKUP_FAILED'");
  });
  it('a failed fan-out is retried by the telemetry row, not dropped', () => {
    const ads = read('apps/api/src/infrastructure/advertising/AdConversionDispatch.ts');
    const fanOut = ads.slice(ads.indexOf('export async function fanOutAdConversions'), ads.indexOf('export async function processAdConversionBatch'));
    expect(fanOut).toContain('throw err;');
    expect(fanOut).not.toContain('return 0;');
  });
  it('a withdrawal carries no expiry', () => {
    const repo = read('apps/api/src/infrastructure/measurement/DrizzleConsentRepository.ts');
    expect(repo.match(/expiresAt: {13,}null/g)?.length).toBe(2);
  });
});

describe('the preference centre shows what is really sent to ad platforms', () => {
  const prefs = { async getPreferences() { return null; } } as never;
  const service = (row: unknown) =>
    new ConsentService({ async getCurrentState() { return { row }; } } as never, silentLogger);

  it('no stored choice: conversions are sent (D-002), so the switch shows ON', async () => {
    const dto = await new GetCustomerPreferenceCentreUseCase(prefs, service(null)).execute('u1');
    expect(dto.consent.advertising).toBe(true);
  });
  it('a stored refusal shows OFF, even once its 180-day stamp has passed', async () => {
    const row = { advertisingGranted: false, analyticsGranted: true, personalizationGranted: true, lastGrantType: 'explicit', expiresAt: new Date('2020-01-01') };
    const dto = await new GetCustomerPreferenceCentreUseCase(prefs, service(row)).execute('u1');
    expect(dto.consent.advertising).toBe(false);
  });
  it('the switch says what it controls', () => {
    expect(read('apps/web/src/components/preferences/PreferenceCentreForm.astro')).toMatch(/your purchases and the products you view or add to your basket are shared with the advertising platforms/);
  });
});

describe('our own robots are not shoppers', () => {
  it('the collector recognises declared automation by user agent', () => {
    expect(isDeclaredAutomationUa('Mozilla/5.0 (X11) Chrome/136.0 Safari/537.36 GoldPlusSyntheticProbe')).toBe(true);
    expect(isDeclaredAutomationUa('Mozilla/5.0 Chrome-Lighthouse')).toBe(true);
    expect(isDeclaredAutomationUa('Mozilla/5.0 (Linux; Android 14) Chrome/136.0 Mobile Safari/537.36')).toBe(false);
    expect(isDeclaredAutomationUa(null)).toBe(false);
  });
  it('every collector path skips enqueueing behavioural events for it; touches stay, classed automated', () => {
    const route = read('apps/api/src/interfaces/http/routes/telemetry.ts');
    expect(route).toContain("if (isDeclaredAutomationUa(realUa)) return c.json({ success: true, event_id: parsed.data.event_id }, 202);");
    expect(route).toMatch(/declaredAutomation\s*\? Promise\.resolve\(\)/);
    expect(route).toContain('if (declaredAutomation) { results.push({ event_id: parsed.data.event_id, ok: true }); continue; }');
    expect(route).toContain('const automatedUa = declaredAutomation;');
  });
  it('the storefront SDK sends nothing from webdriver, the gp_probe cookie or a declared UA', () => {
    const sdk = read('apps/web/src/lib/telemetry.ts');
    expect(sdk).toContain('if (isOwnAutomation()) return eventId;');
    expect(sdk).toContain('if (isOwnAutomation()) { queue.splice(0, queue.length); return; }');
    expect(sdk).toMatch(/\.webdriver[\s\S]{0,120}PROBE_COOKIE[\s\S]{0,120}isDeclaredAutomation\(navigator\.userAgent\)/);
  });
  it('no per-event identity-graph write remains (owner decision 2026-09-24)', () => {
    expect(code('apps/api/src/application/use-cases/telemetry/TrackBrowserTelemetryEventUseCase.ts')).not.toMatch(/upsertByFpClientId|DrizzleIdentityRepository/);
  });
});

describe('a return from the payment gateway is not a new arrival', () => {
  it('storefront: PesaPal and our own subdomains are internal referrers', () => {
    expect(isInternalReferrerHost('pay.pesapal.com', 'shopgoldplus.com')).toBe(true);
    expect(isInternalReferrerHost('cybqa.pesapal.com', 'www.shopgoldplus.com')).toBe(true);
    expect(isInternalReferrerHost('api.shopgoldplus.com', 'shopgoldplus.com')).toBe(true);
    expect(isInternalReferrerHost('shopgoldplus.com', 'www.shopgoldplus.com')).toBe(true);
    expect(isInternalReferrerHost('l.facebook.com', 'shopgoldplus.com')).toBe(false);
    expect(isInternalReferrerHost('notpesapal.com', 'shopgoldplus.com')).toBe(false);
    expect(read('apps/web/src/lib/attribution.ts')).toContain('!isInternalReferrerHost(host, location.host)');
    expect(read('apps/web/src/lib/telemetry.ts')).toContain('!isInternalReferrerHost(h, location.host)');
  });
  it('server safety net: those hosts classify as direct, a real referrer as referral', () => {
    expect(classifyChannel({ referrerHost: 'pay.pesapal.com' })).toBe('direct');
    expect(classifyChannel({ referrerHost: 'api.shopgoldplus.com' })).toBe('direct');
    expect(classifyChannel({ referrerHost: 'someblog.ug' })).toBe('referral');
  });
});

describe('the server-set visitor id reaches the collector on api.', () => {
  it('is scoped to the registrable domain on our hosts only', () => {
    expect(visitorCookieDomain('shopgoldplus.com')).toBe('shopgoldplus.com');
    expect(visitorCookieDomain('www.shopgoldplus.com')).toBe('shopgoldplus.com');
    expect(visitorCookieDomain('localhost')).toBeUndefined();
    expect(visitorCookieDomain('evilshopgoldplus.com')).toBeUndefined();
    expect(read('apps/web/src/middleware.ts')).toContain('domain: visitorCookieDomain(context.url.hostname)');
  });
});

describe('the Measurement Control Tower reports what exists', () => {
  const src = read('apps/api/src/infrastructure/admin/DrizzleMeasurementControlTowerRepository.ts');
  it('queued is the pending outbox, failed is the dead-letter backlog', () => {
    expect(src).toContain('eventsQueued: queuedCount.value,');
    expect(src).toContain('eventsFailed: dlqCountResult.value,');
    expect(src).toMatch(/eq\(outboxEvents\.eventType, 'TELEMETRY_DISPATCH'\), eq\(outboxEvents\.isProcessed, false\)/);
  });
  it('verified purchases come from the real GA4 delivery; readiness from live ad destinations', () => {
    expect(src).not.toMatch(/status, 'VERIFIED'\)|status, 'PENDING'\)/);
    expect(src).toContain("from measurement.delivery_intent where sink_key = 'ga4:purchase'");
    expect(src).toContain("metaReadiness: readiness('meta'),");
    expect(src).not.toMatch(/metaReadiness: 'NOT_CONFIGURED'/);
  });
});

describe('the legacy purchase-measurement queue says "Not configured"', () => {
  it('a null queue queues nothing and says so', async () => {
    const q = new BullMqPurchaseMeasurementQueue(null, silentLogger);
    const data = { orderId: 'o1', paymentReference: null, eventId: 'e1', idempotencyKey: 'k1' } as never;
    expect(await q.enqueuePurchaseMeasurement(data)).toBe(false);
    expect(await q.enqueuePurchaseRetry(data)).toBe(false);
  });
  it('a retry records NOT_CONFIGURED, never RETRY_QUEUED', async () => {
    const statuses: string[] = [];
    const repo = {
      async getReconciliationByOrderId() { return { id: 'r1', status: 'FAILED' }; },
      async findPurchaseEventByOrderId() { return { orderId: 'o1', paymentReference: null, eventId: 'e1', idempotencyKey: 'k1' }; },
      async updateReconciliationStatus(_id: string, s: string) { statuses.push(s); return { id: 'r1', status: s }; },
    };
    const out = await new RetryPaymentMeasurementReconciliationUseCase(repo as never, new BullMqPurchaseMeasurementQueue(null, silentLogger)).execute({ orderId: 'o1' });
    expect(out.status).toBe('NOT_CONFIGURED');
    expect(statuses).toEqual(['NOT_CONFIGURED']);
    expect(read('apps/api/src/application/use-cases/measurement/ReconcilePesapalOrderMeasurementUseCase.ts')).toContain("updateReconciliationStatus(reconciliation.id, 'NOT_CONFIGURED')");
  });
});

describe('a double-clicked DLQ replay dispatches once', () => {
  it('the replay is keyed on the DLQ entry and a conflict is absorbed', async () => {
    const calls: unknown[][] = [];
    const uc = new ReplayMeasurementDlqUseCase(
      { async findById() { return { id: 'd1', eventId: 'ev1', payload: {}, isResolved: false }; }, async markResolved() {} } as never,
      { async enqueueTelemetryDispatch(...a: unknown[]) { calls.push(a); } } as never,
      silentLogger,
      { async create() { return { id: 'a1' }; }, async save() {} } as never,
    );
    await uc.execute('d1', 'admin-1').catch(() => undefined);
    expect(calls[0]).toEqual([{}, 'ev1', 'd1']);
    const repo = read('apps/api/src/infrastructure/measurement/DrizzleMeasurementAdminRepository.ts');
    expect(repo).toContain('return `dlq-replay:${replayKey ?? eventId}`;');
    expect(code('apps/api/src/infrastructure/measurement/DrizzleMeasurementAdminRepository.ts')).not.toContain('Date.now()');
    expect(repo).toContain('.onConflictDoNothing({ target: outboxEvents.idempotencyKey })');
  });
});

describe('the payment reconciliation list pages safely', () => {
  it('limit 1..100 (default 50), offset >= 0', () => {
    expect(reconciliationPage()).toEqual({ offset: 0, limit: 50 });
    expect(reconciliationPage({ limit: 100000, offset: -5 })).toEqual({ offset: 0, limit: 100 });
    expect(reconciliationPage({ limit: 0, offset: 20 })).toEqual({ offset: 20, limit: 50 });
  });
  it('counts in SQL and orders the page', () => {
    const src = read('apps/api/src/infrastructure/measurement/DrizzlePaymentMeasurementRepository.ts');
    expect(src).toContain('db.select({ value: count() }).from(paymentMeasurementReconciliations)');
    expect(src).toContain('.orderBy(desc(paymentMeasurementReconciliations.createdAt), desc(paymentMeasurementReconciliations.id))');
  });
});

// ─── Recommendations ────────────────────────────────────────────────────────

describe('recommendation events survive long browser values', () => {
  it('each value is cut to its column width, never rejected', () => {
    const campaign = 'c'.repeat(151);
    expect(fitColumn('utmCampaign', campaign)).toHaveLength(150);
    expect(fitColumn('referrer', 'r'.repeat(520))).toHaveLength(500);
    expect(fitColumn('pagePath', '/short')).toBe('/short');
    expect(fitColumn('utmTerm', undefined)).toBeUndefined();
    expect(fitColumn('language', null)).toBeNull();
    expect(RECOMMENDATION_EVENT_TEXT_WIDTHS.utmSource).toBe(100);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleRecommendationEventRepository.ts')).toContain("utmCampaign: fitColumn('utmCampaign', event.utm?.campaign),");
  });
});

describe('"Popular right now" counts people, not POSTs', () => {
  it('trending counts distinct server-resolved visitors and ignores identity-less rows', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleRecommendationEventRepository.ts');
    expect(src).toContain("count(distinct coalesce(${recommendationEvents.profileId}::text, 'c:' || ${recommendationEvents.customerId}::text))");
    expect(src).toContain('sql`(${recommendationEvents.profileId} is not null or ${recommendationEvents.customerId} is not null)`');
    expect(src).toContain('.orderBy(desc(visitors), asc(productKey), asc(recommendationEvents.eventType))');
  });
});

describe('rails respect the catalogue and the cart', () => {
  const product = (id: string) => ({
    id, slug: `p-${id}`, name: `Product ${id}`, categoryId: 'c1', imageUrl: `https://img/${id}`, price: 20_000,
    stockStatus: 'in_stock', stockQuantity: 5, isActive: true,
  });
  function engine(cacheCalls: string[]) {
    const reader = {
      async findPublicProducts(input?: { productIds?: string[]; excludeProductIds?: string[]; limit?: number }) {
        let rows = ['a', 'b', 'c', 'd', 'e'].map(product);
        if (input?.productIds) rows = rows.filter((p) => input.productIds!.includes(p.id));
        if (input?.excludeProductIds) rows = rows.filter((p) => !input.excludeProductIds!.includes(p.id));
        return rows.slice(0, input?.limit ?? 200);
      },
      async findProductById() { return null; },
      async findProductsByIds() { return []; },
      async findBestsellerProductIds() { return []; },
      async findCompatibilityTargetIds() { return []; },
      async findRecentPaidProductIdsForProfile() { return []; },
      async findCachedRecommendations(placement: string, key: string) {
        cacheCalls.push(`${placement}:${key}`);
        return { items: [], updatedAt: new Date() };
      },
      async saveCachedRecommendations() {},
    };
    const events = {
      async save() { return true; }, async existsRecentSimilarEvent() { return false; }, async findRecentlyViewed() { return []; },
      async findRecentlyShownProductIds() { return []; }, async findRecentSearchQueries() { return []; }, async getTrendingEvents() { return []; },
    };
    return new GetRecommendationsUseCase(
      reader as never, new ProductSignalExtractor(), new RecommendationScoringService(new CompatibilityRuleService()),
      new TrendingScoreService(events as never), new RecommendationEligibilityService(), new RecommendationDeduplicationService(),
      new RecommendationDiversityService(),
      new RecommendationRuleApplicationService({ async findActiveRulesForPlacement() { return []; } } as never, new RecommendationEligibilityService(), new RecommendationRuleConflictService()),
    );
  }

  it('a real cart builds its add-on rail live; an empty cart may use the cache', async () => {
    const calls: string[] = [];
    await engine(calls).execute({ placement: 'cart_addon', cartProductIds: ['a'], limit: 4 });
    expect(calls).toEqual([]);
    await engine(calls).execute({ placement: 'cart_addon', limit: 4 });
    expect(calls).toEqual(['cart_addon:global']);
  });

  it('retired products (410 / unpublish / 301) leave every rail', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleProductRecommendationReader.ts');
    expect(src).toContain('conditions.push(notRetiredByLifecycle(sql`${products.id}`));');
  });

  it('recently viewed serves public products only, never a draft by id', async () => {
    const asked: string[] = [];
    const reader = {
      async findPublicProducts(input: { productIds: string[] }) { asked.push('public'); return input.productIds.filter((id) => id !== 'draft').map(product); },
      async findProductsByIds() { asked.push('any'); return [product('draft')]; },
    };
    const events = { async findRecentlyViewed() { return [{ productId: 'draft', viewedAt: new Date() }, { productId: 'a', viewedAt: new Date() }]; } };
    const out = await new GetRecentlyViewedUseCase(events as never, reader as never, new ProductSignalExtractor(), new RecommendationEligibilityService()).execute({ anonymousId: 'anon_x' });
    expect(asked).toEqual(['public']);
    expect(out.items.map((i) => i.productId)).toEqual(['a']);
  });
});

describe('recommendation experiments cannot run as an unannounced A/A test', () => {
  it('starting a rec_ experiment is refused as NOT_CONFIGURED; other experiments start', async () => {
    const make = (key: string) => {
      const repo = {
        async find() { return { id: 'e1', key, status: 'READY', version: 1 }; },
        async transition() { return { id: 'e1', key, status: 'RUNNING', version: 2 }; },
      };
      return new ExperimentOperationsUseCase(repo as never, { async execute() { return {}; } } as never);
    };
    await expect(make('rec_holdout').transition({ id: 'e1', expectedVersion: 1, to: 'RUNNING', actorId: 'a', reason: 'go' }))
      .rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(make('checkout_copy').transition({ id: 'e1', expectedVersion: 1, to: 'RUNNING', actorId: 'a', reason: 'go' }))
      .resolves.toMatchObject({ status: 'RUNNING' });
  });

  it('assignment reads the experiment list at most once a minute', async () => {
    let lists = 0;
    let now = 0;
    const repo = { async list() { lists += 1; return []; } };
    const uc = new AssignRecommendationExperimentUseCase(repo as never, {} as never, () => now);
    await uc.execute('p1'); await uc.execute('p2');
    expect(lists).toBe(1);
    now = 61_000;
    await uc.execute('p3');
    expect(lists).toBe(2);
  });

  it('the readiness report says so', () => {
    expect(read('apps/api/src/application/recommendations/RecommendationModelReadiness.ts')).toContain('Recommendation experiments are not configured: no variant changes what the rails serve');
  });
});

// ─── Merchant feed ──────────────────────────────────────────────────────────

describe('the Merchant feed stays well-formed and approvable', () => {
  const base = (over: Partial<FeedProduct> = {}): FeedProduct => ({
    sku: 'GP-1', slug: 'gp-1', name: 'GoldPlus 20W USB-C Charger', shortDescription: 'A 20W USB-C charger, tested before it is sold, for phones and tablets.',
    priceUgx: 150_000, stockStatus: 'in_stock', imageUrl: '/uploads/a.webp', modelNumber: 'GP-C20', isFeedEligible: true, active: true, approvalStatus: 'approved', ...over,
  });

  it('control characters are dropped before escaping', () => {
    expect(escapeXml('A\u000Bvertical tab & \u0000nul￿')).toBe('Avertical tab &amp; nul');
    expect(buildMerchantFeedXml([base({ shortDescription: 'Pasted from Excel\u000B with a stray tab, long enough to describe it.' })])).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it('an empty description keeps an item out, and the report says why', async () => {
    expect(isFeedIncluded(base({ shortDescription: '', longDescription: '' }))).toBe(false);
    expect(isFeedIncluded(base({ shortDescription: '', longDescription: 'The long text the owner wrote.' }))).toBe(true);
    const report = await new FeedQualityUseCase(async () => [base({ shortDescription: '  ', longDescription: null })]).execute();
    expect(report.products[0].issues).toContain('missing_description');
    expect(report.products[0].included).toBe(false);
  });

  it('no MPN = identifier_exists no', () => {
    expect(buildMerchantFeedXml([base({ modelNumber: '' })])).toContain('<g:identifier_exists>no</g:identifier_exists>');
    expect(buildMerchantFeedXml([base()])).not.toContain('identifier_exists');
  });

  it('a dateless pre-order goes as out of stock and the report names it', async () => {
    const report = await new FeedQualityUseCase(async () => [base({ stockStatus: 'pre_order' })]).execute();
    expect(report.products[0].issues).toContain('preorder_without_date');
  });
});

// ─── Held item 15: phone-only leads (owner decision 2026-09-24) ─────────────

describe('quote requests, fake reports and dealer applications accept a phone number without email', () => {
  it('a quote with no email is saved with an empty email; a mistyped one is still caught', async () => {
    const saved: Array<{ email: string }> = [];
    const uc = new RequestQuoteUseCase({ async save(q: { email: string }) { saved.push(q); } } as never);
    const ok = await uc.execute({ customerName: 'Mbale Traders', email: '', phone: '0772123456', productName: 'Power banks', quantity: '20', kind: 'wholesale' });
    expect(ok.ok).toBe(true);
    expect(saved[0].email).toBe('');
    const bad = await uc.execute({ customerName: 'Mbale Traders', email: 'not-an-email', phone: '0772123456', productName: 'Power banks', quantity: '20', kind: 'wholesale' });
    expect(bad).toMatchObject({ ok: false, code: 'BAD_INPUT' });
  });

  it('a fake report with only a phone is accepted', async () => {
    const saved: unknown[] = [];
    const out = await new ReportFakeProductUseCase({ async save(r: unknown) { saved.push(r); } } as never)
      .execute({ locationFound: 'Kikuubo', productDescription: 'A power bank with a fake GoldPlus code', reporterEmail: '', reporterPhone: '0772123456' } as never);
    expect(out.ok).toBe(true);
    expect(JSON.stringify(saved[0])).toContain('Phone: ');
    expect(JSON.stringify(saved[0])).not.toContain('Email: ');
  });

  it('a dealer application with only a phone is accepted', async () => {
    const saved: Array<{ email: string }> = [];
    await new DealerApplicationUseCase({ async save(d: { email: string }) { saved.push(d); } } as never)
      .execute({ businessName: 'Gulu Phones', contactName: 'Okello', email: '', phone: '0772123456', tinNumber: '', location: 'Gulu' } as never);
    expect(saved[0].email).toBe('');
  });

  it('the pages no longer require it, on the server or in the browser', () => {
    for (const [page, field] of [['apps/web/src/pages/quote-request.astro', 'email'], ['apps/web/src/pages/dealers/apply.astro', 'email'], ['apps/web/src/pages/support/fake.astro', 'reporterEmail']] as const) {
      const src = read(page);
      expect(src, page).toMatch(/\(optional\)/);
      expect(src, page).not.toMatch(/if \(!isValidEmail\(/);
      expect(src, page).not.toMatch(new RegExp(`id="${field}" name="${field}"[^>]*required`));
    }
    expect(read('apps/web/src/pages/support/issue.astro')).toContain("if (emailInput.value.trim() && !isValidEmail(emailInput.value)) {");
  });
});
