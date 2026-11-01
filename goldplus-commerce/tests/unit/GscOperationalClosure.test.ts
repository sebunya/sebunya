import { describe, expect, it } from 'vitest';

import {
  resolveLandingPage, normalizeLandingUrl, attributionStateOf,
  type RouteTruth,
} from '../../apps/api/src/application/use-cases/seo-growth/LandingPageEntityResolver';
import {
  projectObservationsToQueries, conserveMetrics,
  type GscObservation,
} from '../../apps/api/src/application/use-cases/seo-growth/GscQueryProjection';
import {
  planSchedules, jobIdFor, patternFor, isSchedulable, decideDueConnections,
  type SchedulableConnection,
} from '../../apps/api/src/application/use-cases/seo-growth/IntegrationScheduleReconciler';

/**
 * Fixtures are the REAL production shapes, taken from the first live sync:
 * product pages under /products/<slug>, category browsing via
 * /shop?category=power, the www homepage. The previous resolver was written
 * against an imagined /<category-slug> route and matched none of them.
 */
const TRUTH: RouteTruth = {
  categoryByKey: new Map([
    // Canonical taxonomy slugs, plus the operator-editable aliases the shop
    // page resolves through. "power" -> "power-devices" is the real mapping.
    ['power-devices', 'power-devices'], ['power', 'power-devices'],
    ['sound-devices', 'sound-devices'], ['sound', 'sound-devices'],
    ['storage-devices', 'storage-devices'], ['storage', 'storage-devices'],
  ]),
  productIdBySlug: new Map([
    ['goldplus-32gb-memory-card', 'prod-mem-32'],
    ['goldplus-50w-pps-charger', 'prod-chg-50'],
  ]),
  // storage-devices exists in the taxonomy but NOT in the catalogue.
  knownCategorySlugs: new Set(['power-devices', 'sound-devices', 'other']),
};

const ALLOW = ['shopgoldplus.com', 'www.shopgoldplus.com'];

// ── URL normalisation (§30) ─────────────────────────────────────────────────

describe('landing URLs normalise to one identity per page', () => {
  it('collapses www and non-www to one form', () => {
    expect(normalizeLandingUrl('https://www.shopgoldplus.com/'))
      .toBe(normalizeLandingUrl('https://shopgoldplus.com/'));
  });

  it('collapses http and https', () => {
    expect(normalizeLandingUrl('http://shopgoldplus.com/shop'))
      .toBe(normalizeLandingUrl('https://shopgoldplus.com/shop'));
  });

  it('collapses a trailing slash but keeps the root', () => {
    expect(normalizeLandingUrl('https://shopgoldplus.com/shop/'))
      .toBe(normalizeLandingUrl('https://shopgoldplus.com/shop'));
    expect(normalizeLandingUrl('https://shopgoldplus.com/')).toContain('shopgoldplus.com/');
  });

  it('drops tracking parameters', () => {
    expect(normalizeLandingUrl('https://shopgoldplus.com/shop?utm_source=google&gclid=abc'))
      .toBe(normalizeLandingUrl('https://shopgoldplus.com/shop'));
  });

  it('PRESERVES the semantic category parameter', () => {
    // Stripping this would destroy the page's identity — every category
    // listing would collapse into one unfiltered shop page.
    const n = normalizeLandingUrl('https://shopgoldplus.com/shop?category=power&utm_medium=cpc');
    expect(n).toContain('category=power');
    expect(n).not.toContain('utm_medium');
  });

  it('does not let parameter order create two identities', () => {
    expect(normalizeLandingUrl('https://shopgoldplus.com/shop?subcategory=b&category=a'))
      .toBe(normalizeLandingUrl('https://shopgoldplus.com/shop?category=a&subcategory=b'));
  });

  it('drops a fragment', () => {
    expect(normalizeLandingUrl('https://shopgoldplus.com/shop#reviews'))
      .toBe(normalizeLandingUrl('https://shopgoldplus.com/shop'));
  });
});

// ── Route resolution (§29, §32–§34) ─────────────────────────────────────────

describe('real production routes resolve to real entities', () => {
  it('resolves a known product URL to its exact product', () => {
    const r = resolveLandingPage('https://shopgoldplus.com/products/goldplus-32gb-memory-card', TRUTH, ALLOW);
    expect(r.pageType).toBe('PRODUCT');
    expect(r.entityType).toBe('PRODUCT');
    expect(r.entityId).toBe('prod-mem-32');
    expect(r.confidence).toBe(1);
  });

  it('resolves ?category=power through the taxonomy alias, as the shop page does', () => {
    const r = resolveLandingPage('https://shopgoldplus.com/shop?category=power', TRUTH, ALLOW);
    expect(r.pageType).toBe('CATEGORY');
    expect(r.entityId).toBe('/power-devices');
    expect(r.method).toBe('TAXONOMY_ALIAS');
    expect(r.reason).toMatch(/alias/i);
  });

  it('resolves a canonical category slug directly', () => {
    const r = resolveLandingPage('https://shopgoldplus.com/shop?category=power-devices', TRUTH, ALLOW);
    expect(r.entityId).toBe('/power-devices');
    expect(r.method).toBe('TAXONOMY_SLUG');
  });

  it('resolves the www homepage as HOME and attributes it to no category', () => {
    const r = resolveLandingPage('https://www.shopgoldplus.com/', TRUTH, ALLOW);
    expect(r.pageType).toBe('HOME');
    expect(r.entityType).toBe('HOME');
    // The failure this prevents: silently crediting homepage demand to a
    // category nobody proved was involved.
    expect(r.entityId).toBe('/');
    expect(r.reason).toMatch(/not evidence about any product or category/i);
  });

  it('leaves an unknown product slug UNMAPPED rather than guessing', () => {
    const r = resolveLandingPage('https://shopgoldplus.com/products/does-not-exist', TRUTH, ALLOW);
    expect(r.pageType).toBe('UNMAPPED');
    expect(r.entityId).toBeNull();
    expect(r.reason).toMatch(/nearest match would be worse/i);
  });

  it('leaves an unknown category key UNMAPPED', () => {
    const r = resolveLandingPage('https://shopgoldplus.com/shop?category=nonsense', TRUTH, ALLOW);
    expect(r.pageType).toBe('UNMAPPED');
  });

  it('does not attribute a taxonomy category the catalogue does not have', () => {
    const r = resolveLandingPage('https://shopgoldplus.com/shop?category=storage', TRUTH, ALLOW);
    expect(r.pageType).toBe('UNMAPPED');
    expect(r.reason).toMatch(/no corresponding catalogue category/i);
  });

  it('treats an unfiltered shop listing as internal, not as a category', () => {
    const r = resolveLandingPage('https://shopgoldplus.com/shop?sort=price-high-low', TRUTH, ALLOW);
    expect(r.pageType).toBe('OTHER_INTERNAL');
    expect(r.entityType).toBeNull();
  });

  it('REJECTS a foreign host outright', () => {
    const r = resolveLandingPage('https://evil.example.com/shop?category=power', TRUTH, ALLOW);
    expect(r.pageType).toBe('REJECTED');
    expect(r.entityId).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('rejects a look-alike host', () => {
    expect(resolveLandingPage('https://shopgoldplus.com.evil.net/', TRUTH, ALLOW).pageType).toBe('REJECTED');
  });

  it('rejects a non-http scheme and an IP literal', () => {
    expect(resolveLandingPage('file:///etc/passwd', TRUTH, ALLOW).pageType).toBe('REJECTED');
    expect(resolveLandingPage('http://127.0.0.1/shop', TRUTH, ALLOW).pageType).toBe('REJECTED');
  });

  it('never treats a URL substring as authority', () => {
    // A blog post whose path merely contains the words is not the category.
    const r = resolveLandingPage('https://shopgoldplus.com/blog/power-devices-guide', TRUTH, ALLOW);
    expect(r.entityType).not.toBe('CATEGORY');
  });
});

describe('attribution states partition every observation', () => {
  it('classifies product and category pages as ATTRIBUTED', () => {
    expect(attributionStateOf(resolveLandingPage('https://shopgoldplus.com/products/goldplus-50w-pps-charger', TRUTH, ALLOW))).toBe('ATTRIBUTED');
    expect(attributionStateOf(resolveLandingPage('https://shopgoldplus.com/shop?category=power', TRUTH, ALLOW))).toBe('ATTRIBUTED');
  });

  it('classifies home and internal pages as PARTIAL, not UNMAPPED', () => {
    expect(attributionStateOf(resolveLandingPage('https://shopgoldplus.com/', TRUTH, ALLOW))).toBe('PARTIAL');
  });

  it('classifies unknown and rejected as UNMAPPED', () => {
    expect(attributionStateOf(resolveLandingPage('https://shopgoldplus.com/products/nope', TRUTH, ALLOW))).toBe('UNMAPPED');
    expect(attributionStateOf(resolveLandingPage('https://evil.example.com/', TRUTH, ALLOW))).toBe('UNMAPPED');
  });
});

// ── Query projection (§20–§24, §58) ─────────────────────────────────────────

const obs = (query: string, date: string, page: string, impressions = 10, clicks = 1): GscObservation =>
  ({ query, date, page, impressions, clicks });

describe('provider observations collapse to semantic query identities', () => {
  it('produces ONE identity for the same query across many dates', () => {
    const r = projectObservationsToQueries([
      obs('samsung battery', '2026-08-08', '/a'),
      obs('samsung battery', '2026-08-09', '/a'),
      obs('samsung battery', '2026-08-10', '/a'),
    ]);
    expect(r.identities).toBe(1);
    expect(r.observationsRead).toBe(3);
  });

  it('produces ONE identity for the same query across different pages', () => {
    const r = projectObservationsToQueries([
      obs('samsung battery', '2026-08-08', '/products/x'),
      obs('samsung battery', '2026-08-08', '/shop?category=power'),
    ]);
    // The page observations stay distinct in gsc_performance; the query is
    // still one subject.
    expect(r.identities).toBe(1);
  });

  it('applies the existing normalisation, so plural variants are one identity', () => {
    const r = projectObservationsToQueries([
      obs('samsung battery', '2026-08-08', '/a'),
      obs('samsung batteries', '2026-08-09', '/a'),
    ]);
    expect(r.identities).toBe(1);
  });

  it('keeps commercially distinct queries separate', () => {
    const r = projectObservationsToQueries([
      obs('128gb memory card', '2026-08-08', '/a'),
      obs('256gb memory card', '2026-08-08', '/a'),
    ]);
    expect(r.identities).toBe(2);
  });

  it('advances last_seen only to the newest observation', () => {
    const r = projectObservationsToQueries([
      obs('power bank', '2026-08-11', '/a'),
      obs('power bank', '2026-08-08', '/a'),
    ]);
    expect(r.queries[0].lastObservedAt).toBe('2026-08-11');
  });

  it('is deterministic regardless of row order', () => {
    const rows = [obs('b query', '2026-08-08', '/a'), obs('a query', '2026-08-09', '/b')];
    const forward = projectObservationsToQueries(rows).queries.map((q) => q.normalized);
    const reversed = projectObservationsToQueries([...rows].reverse()).queries.map((q) => q.normalized);
    expect(reversed).toEqual(forward);
  });

  it('creates no identity on a replay of the same evidence', () => {
    const rows = [obs('solar inverter', '2026-08-08', '/a')];
    const first = projectObservationsToQueries(rows);
    const second = projectObservationsToQueries(rows);
    expect(second.identities).toBe(first.identities);
    expect(second.queries).toEqual(first.queries);
  });

  it('carries no metrics — gsc_performance stays the single source of truth', () => {
    const [q] = projectObservationsToQueries([obs('power bank', '2026-08-08', '/a', 500, 20)]).queries;
    expect(q).not.toHaveProperty('impressions');
    expect(q).not.toHaveProperty('clicks');
  });

  it('skips empty queries rather than creating a blank identity', () => {
    const r = projectObservationsToQueries([obs('   ', '2026-08-08', '/a')]);
    expect(r.identities).toBe(0);
    expect(r.skippedEmpty).toBe(1);
  });
});

// ── Metric conservation (§41) ───────────────────────────────────────────────

describe('semantic processing neither creates nor loses observations', () => {
  const rows = [
    obs('a', '2026-08-08', '/products/x', 100, 5),
    obs('b', '2026-08-08', '/shop?category=power', 40, 2),
    obs('c', '2026-08-08', '/', 10, 0),
    obs('d', '2026-08-08', '/products/unknown', 7, 1),
  ];

  it('partitions observations and conserves impressions and clicks', () => {
    const r = conserveMetrics({ observations: rows, states: ['ATTRIBUTED', 'ATTRIBUTED', 'PARTIAL', 'UNMAPPED'] });
    expect(r.conserved).toBe(true);
    expect(r.attributed + r.partial + r.unmapped).toBe(rows.length);
    expect(r.attributedImpressions + r.partialOrUnmappedImpressions).toBe(r.rawImpressions);
    expect(r.attributedClicks + r.partialOrUnmappedClicks).toBe(r.rawClicks);
    expect(r.rawImpressions).toBe(157);
  });

  it('detects impressions being multiplied', () => {
    const doubled = [...rows, rows[0]];   // the same observation counted twice
    const r = conserveMetrics({ observations: doubled, states: ['ATTRIBUTED', 'ATTRIBUTED', 'PARTIAL', 'UNMAPPED', 'ATTRIBUTED'] });
    // Conservation still holds internally, but the raw total has grown —
    // which is exactly what a double-count looks like at the source.
    expect(r.rawImpressions).toBe(257);
    expect(r.attributed).toBe(3);
  });

  it('reports a violation when states do not cover every observation', () => {
    const r = conserveMetrics({ observations: rows, states: ['ATTRIBUTED'] });
    expect(r.conserved).toBe(false);
    expect(r.violations.join(' ')).toMatch(/does not match/i);
  });
});

// ── Scheduler (§5–§13, §60) ─────────────────────────────────────────────────

const conn = (over: Partial<SchedulableConnection> = {}): SchedulableConnection => ({
  id: 'conn-1', providerId: 'google-search-console', status: 'HEALTHY',
  syncFrequency: 'DAILY', hasActiveCredential: true, ...over,
});

describe('a stored cadence becomes exactly one real schedule', () => {
  it('derives a deterministic job id from job type and connection', () => {
    expect(jobIdFor('conn-1')).toBe('seo-integration-sync:conn-1');
    // Provider name alone would collide across connections.
    expect(jobIdFor('conn-2')).not.toBe(jobIdFor('conn-1'));
  });

  it('creates one schedule for an eligible connection', () => {
    const plan = planSchedules({ connections: [conn()], existing: [] });
    expect(plan.desired).toHaveLength(1);
    expect(plan.desired[0].jobId).toBe('seo-integration-sync:conn-1');
    expect(plan.desired[0].pattern).toBe(patternFor('DAILY'));
  });

  it('is a no-op when the correct schedule already exists', () => {
    const existing = [{ jobId: jobIdFor('conn-1'), pattern: patternFor('DAILY')! }];
    const plan = planSchedules({ connections: [conn()], existing });
    expect(plan.obsolete).toHaveLength(0);
    expect(plan.replace).toHaveLength(0);
  });

  it('replaces the schedule when the cadence changes', () => {
    const existing = [{ jobId: jobIdFor('conn-1'), pattern: patternFor('DAILY')! }];
    const plan = planSchedules({ connections: [conn({ syncFrequency: 'HOURLY' })], existing });
    expect(plan.replace).toHaveLength(1);
    expect(plan.replace[0].pattern).toBe(patternFor('HOURLY'));
  });

  it('removes the schedule when the connection is disabled', () => {
    const existing = [{ jobId: jobIdFor('conn-1'), pattern: patternFor('DAILY')! }];
    const plan = planSchedules({ connections: [conn({ status: 'DISABLED' })], existing });
    expect(plan.obsolete).toContain(jobIdFor('conn-1'));
    expect(plan.desired).toHaveLength(0);
  });

  it('removes the schedule when the credential is gone', () => {
    const existing = [{ jobId: jobIdFor('conn-1'), pattern: patternFor('DAILY')! }];
    const plan = planSchedules({ connections: [conn({ hasActiveCredential: false })], existing });
    expect(plan.obsolete).toContain(jobIdFor('conn-1'));
  });

  it('removes a schedule whose connection no longer exists', () => {
    const existing = [{ jobId: 'seo-integration-sync:deleted-conn', pattern: patternFor('DAILY')! }];
    const plan = planSchedules({ connections: [], existing });
    expect(plan.obsolete).toEqual(['seo-integration-sync:deleted-conn']);
  });

  it('restores the schedule when a connection is re-enabled', () => {
    const plan = planSchedules({ connections: [conn({ status: 'READY' })], existing: [] });
    expect(plan.desired).toHaveLength(1);
  });

  it('never touches schedules outside its own family', () => {
    const existing = [{ jobId: 'search-console-guardian-job', pattern: '0 */6 * * *' }];
    const plan = planSchedules({ connections: [conn()], existing });
    expect(plan.obsolete).toHaveLength(0);
  });

  it('refuses to invent a schedule for an unrecognised cadence', () => {
    const plan = planSchedules({ connections: [conn({ syncFrequency: 'FORTNIGHTLY' })], existing: [] });
    expect(plan.desired).toHaveLength(0);
    expect(plan.reasons.join(' ')).toMatch(/not a recognised frequency/i);
  });

  it('produces identical output when planned repeatedly', () => {
    const a = planSchedules({ connections: [conn()], existing: [] });
    const b = planSchedules({ connections: [conn()], existing: [] });
    expect(b.desired).toEqual(a.desired);
  });

  it('does not schedule a connection in a pre-credential state', () => {
    for (const status of ['NOT_CONFIGURED', 'CONFIGURING', 'AUTHORIZATION_REQUIRED', 'DISABLED']) {
      expect(isSchedulable(conn({ status }))).toBe(false);
    }
  });
});

// ── Provider admin DTO contract (§14–§16) ───────────────────────────────────

import { toProviderAdminView } from '../../apps/api/src/interfaces/http/routes/admin/seo-integrations';

/** A row exactly as seo_integration_providers stores it. */
const providerRow = () => ({
  provider_id: 'google-search-console',
  canonical_name: 'Google Search Console',
  family: 'GOOGLE_SEARCH',
  description: 'Search analytics.',
  auth_types: ['SERVICE_ACCOUNT', 'OAUTH2'],
  capabilities: ['SEARCH_ANALYTICS'],
  // Operational flags: their own column.
  supports: { manualSync: true, backfill: true, testConnection: true, incrementalSync: true },
  default_sync_frequency: 'DAILY',
  docs_url: 'https://developers.google.com/webmaster-tools',
  enabled: true,
  experimental: false,
  adapter_version: '1',
  // Declarative descriptors only — no operational flags.
  manifest: { quota: { dailyRequestCap: 2000 }, configurationSchema: [], credentialSchema: [] },
});

describe('the provider admin view exposes capability where consumers read it', () => {
  it('puts supports at the TOP LEVEL, not inside manifest', () => {
    const view = toProviderAdminView(providerRow());
    // The exact defect: both admin pages read manifest.supports.manualSync,
    // which is permanently undefined, so a supported operation was hidden.
    expect(view.supports.manualSync).toBe(true);
    expect((view.manifest as any).supports).toBeUndefined();
  });

  it('fails loudly if supports is dropped from the contract', () => {
    const view = toProviderAdminView(providerRow());
    expect(view).toHaveProperty('supports');
    expect(view).toHaveProperty('capabilities');
    expect(view).toHaveProperty('manifest');
  });

  it('reports manualSync=false truthfully rather than defaulting to visible', () => {
    const row = { ...providerRow(), supports: { manualSync: false } };
    expect(toProviderAdminView(row).supports.manualSync).toBe(false);
  });

  it('degrades to an empty object rather than throwing when supports is absent', () => {
    const row = { ...providerRow(), supports: null };
    expect(toProviderAdminView(row).supports).toEqual({});
    // Absent capability must read as "not supported", never as supported.
    expect((toProviderAdminView(row).supports as any).manualSync).toBeUndefined();
  });

  it('keeps declarative descriptors in the manifest', () => {
    const view = toProviderAdminView(providerRow());
    expect((view.manifest as any).quota.dailyRequestCap).toBe(2000);
  });
});


// ── Due-based collection (§9–§11, §60) ──────────────────────────────────────

const HOUR = 3_600_000;
const NOW = Date.parse('2026-08-14T12:00:00Z');

const due = (connections: SchedulableConnection[], lastSuccess: Record<string, number | null>) =>
  decideDueConnections({
    connections,
    lastSuccessMs: new Map(Object.entries(lastSuccess)),
    nowMs: NOW,
  });

describe('collection is due from durable state, not from a schedule that cannot be revoked', () => {
  it('is due when a connection has never collected successfully', () => {
    const [d] = due([conn()], { 'conn-1': null });
    expect(d.due).toBe(true);
    expect(d.reason).toMatch(/never collected/i);
  });

  it('is due once the DAILY interval has elapsed', () => {
    const [d] = due([conn()], { 'conn-1': NOW - 25 * HOUR });
    expect(d.due).toBe(true);
  });

  it('is NOT due before the interval elapses', () => {
    const [d] = due([conn()], { 'conn-1': NOW - 3 * HOUR });
    expect(d.due).toBe(false);
    expect(d.reason).toMatch(/not due/i);
  });

  it('never collects for a disabled connection, however long it has been', () => {
    // The failure a per-connection repeatable risked: a schedule that outlives
    // the connection's eligibility.
    const [d] = due([conn({ status: 'DISABLED' })], { 'conn-1': NOW - 400 * HOUR });
    expect(d.due).toBe(false);
    expect(d.reason).toMatch(/not schedulable/i);
  });

  it('never collects without an active credential', () => {
    const [d] = due([conn({ hasActiveCredential: false })], { 'conn-1': null });
    expect(d.due).toBe(false);
  });

  it('respects a changed cadence immediately, with no re-registration', () => {
    const twoHoursAgo = { 'conn-1': NOW - 2 * HOUR };
    expect(due([conn({ syncFrequency: 'DAILY' })], twoHoursAgo)[0].due).toBe(false);
    expect(due([conn({ syncFrequency: 'HOURLY' })], twoHoursAgo)[0].due).toBe(true);
  });

  it('refuses to collect on an unrecognised cadence rather than inventing one', () => {
    const [d] = due([conn({ syncFrequency: 'FORTNIGHTLY' })], { 'conn-1': null });
    expect(d.due).toBe(false);
    expect(d.reason).toMatch(/not recognised/i);
  });

  it('evaluates a deleted connection by simply not seeing it', () => {
    expect(due([], { 'conn-1': null })).toHaveLength(0);
  });

  it('does not create a catch-up storm after downtime', () => {
    // Long downtime yields exactly ONE due decision, not one per missed day.
    const decisions = due([conn()], { 'conn-1': NOW - 30 * 24 * HOUR });
    expect(decisions.filter((d) => d.due)).toHaveLength(1);
  });

  it('is deterministic for the same inputs', () => {
    const a = due([conn()], { 'conn-1': NOW - 25 * HOUR });
    const b = due([conn()], { 'conn-1': NOW - 25 * HOUR });
    expect(b).toEqual(a);
  });
});
