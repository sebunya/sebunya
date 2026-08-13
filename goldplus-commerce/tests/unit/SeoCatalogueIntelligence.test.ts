import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  validateBatteryCompatInput,
  rankBatteryMatches,
  tokenizeBatteryQuery,
  batteryFinderIndexable,
  batteryStatusLabel,
  PUBLIC_BATTERY_STATUSES,
  SearchBatteryFinderUseCase,
  type BatteryCompatSearchRow,
} from '../../apps/api/src/application/use-cases/seo-growth/BatteryCompatibilityUseCases';
import {
  validateStorageTest,
  deriveStorageResult,
  storageEvidenceState,
  storageEvidenceLabel,
  mayClaimCapacityVerified,
  capacityRatio,
} from '../../apps/api/src/application/use-cases/seo-growth/StorageTestUseCases';
import {
  validateLifecycleDecision,
  lifecycleSeoOutcome,
  allowedDispositionsFor,
  suggestedDisposition,
  rejectBlanketRedirect,
  LIFECYCLE_STATES,
} from '../../apps/api/src/application/use-cases/seo-growth/ProductLifecycleSeoUseCases';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

// ── Battery compatibility ───────────────────────────────────────────────────

describe('battery compatibility never turns thin evidence into a claim', () => {
  it('refuses VERIFIED without an evidence source', () => {
    const r = validateBatteryCompatInput({
      phoneBrand: 'Samsung', phoneModel: 'Galaxy S21', batteryReference: 'EB-BG991ABY',
      status: 'VERIFIED', evidenceNote: 'checked against the handset',
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('EVIDENCE_REQUIRED');
  });

  it('refuses VERIFIED without a note saying what was checked', () => {
    const r = validateBatteryCompatInput({
      phoneBrand: 'Samsung', phoneModel: 'Galaxy S21', batteryReference: 'EB-BG991ABY',
      status: 'VERIFIED', evidenceSource: 'PHYSICAL_QA',
    });
    expect(r.ok === false && r.code).toBe('EVIDENCE_REQUIRED');
  });

  it('accepts VERIFIED with real evidence', () => {
    const r = validateBatteryCompatInput({
      phoneBrand: ' Samsung ', phoneModel: 'Galaxy S21', batteryReference: 'EB-BG991ABY',
      status: 'VERIFIED', evidenceSource: 'PHYSICAL_QA', evidenceNote: 'Fitted and booted in the workshop.',
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.input.phoneBrand).toBe('Samsung');
  });

  it('defaults to UNVERIFIED rather than assuming a fit', () => {
    const r = validateBatteryCompatInput({ phoneBrand: 'Tecno', phoneModel: 'Spark 10', batteryReference: 'BL-49JX' });
    expect(r.ok && r.input.status).toBe('UNVERIFIED');
  });

  it('only ever exposes VERIFIED and PROVISIONAL publicly', () => {
    expect([...PUBLIC_BATTERY_STATUSES].sort()).toEqual(['PROVISIONAL', 'VERIFIED']);
  });
});

const row = (over: Partial<BatteryCompatSearchRow> = {}): BatteryCompatSearchRow => ({
  id: 'r1', phoneBrand: 'Samsung', phoneModel: 'Galaxy S21', modelNumber: 'SM-G991B',
  variant: null, batteryReference: 'EB-BG991ABY', status: 'VERIFIED', product: null, ...over,
});

describe('battery finder matching is exact, never fuzzy guessing', () => {
  it('tokenizes without inventing terms', () => {
    expect(tokenizeBatteryQuery('Galaxy S21+ ')).toEqual(['galaxy', 's21']);
    expect(tokenizeBatteryQuery('')).toEqual([]);
  });

  it('returns nothing for an empty query rather than a catch-all list', () => {
    expect(rankBatteryMatches([], [row()])).toEqual([]);
  });

  it('requires every token to match — a partly-matching row is not a result', () => {
    expect(rankBatteryMatches(['samsung', 'a52'], [row()])).toEqual([]);
    expect(rankBatteryMatches(['samsung', 's21'], [row()])).toHaveLength(1);
  });

  it('filters UNVERIFIED and REJECTED rows even if a repository hands them over', () => {
    const rows = [row({ id: 'u', status: 'UNVERIFIED' }), row({ id: 'x', status: 'REJECTED' })];
    expect(rankBatteryMatches(['samsung'], rows)).toEqual([]);
  });

  it('ranks verified fits above provisional ones', () => {
    const rows = [row({ id: 'prov', status: 'PROVISIONAL' }), row({ id: 'ver', status: 'VERIFIED' })];
    expect(rankBatteryMatches(['samsung'], rows)[0].id).toBe('ver');
  });

  it('labels a provisional fit as needing confirmation, never as verified', () => {
    expect(batteryStatusLabel('VERIFIED')).toBe('Verified fit');
    expect(batteryStatusLabel('PROVISIONAL')).toMatch(/confirm/i);
  });

  it('keeps the finder noindex until it holds enough verified facts', () => {
    expect(batteryFinderIndexable(0)).toBe(false);
    expect(batteryFinderIndexable(4)).toBe(false);
    expect(batteryFinderIndexable(5)).toBe(true);
  });
});

describe('battery finder use case', () => {
  const deps = (rows: BatteryCompatSearchRow[], verified = 9) => {
    const events: any[] = [];
    return {
      events,
      deps: {
        searchRows: async () => rows,
        countVerified: async () => verified,
        recordEvent: async (e: any) => { events.push(e); },
      },
    };
  };

  it('records a no-match search as a catalogue gap', async () => {
    const { events, deps: d } = deps([]);
    const result = await new SearchBatteryFinderUseCase(d).execute('itel a56');
    expect(result.matches).toEqual([]);
    expect(events[0]).toMatchObject({ matched: false, matchCount: 0 });
  });

  it('does not record telemetry for an empty query', async () => {
    const { events, deps: d } = deps([]);
    await new SearchBatteryFinderUseCase(d).execute('   ');
    expect(events).toHaveLength(0);
  });

  it('reports indexability from the real verified count', async () => {
    const { deps: d } = deps([row()], 2);
    const result = await new SearchBatteryFinderUseCase(d).execute('samsung');
    expect(result.indexable).toBe(false);
    expect(result.verifiedCount).toBe(2);
  });
});

// ── Storage testing ─────────────────────────────────────────────────────────

describe('storage testing keeps NOT_TESTED distinct from verified', () => {
  it('reports NOT_TESTED for a product with no records', () => {
    expect(storageEvidenceState([])).toBe('NOT_TESTED');
    expect(mayClaimCapacityVerified('NOT_TESTED')).toBe(false);
    expect(storageEvidenceLabel('NOT_TESTED')).toMatch(/not yet/i);
  });

  it('lets a single failure dominate a later pass', () => {
    expect(storageEvidenceState([{ result: 'PASS' }, { result: 'FAIL' }])).toBe('FAILED');
  });

  it('only VERIFIED may carry the public capacity claim', () => {
    expect(mayClaimCapacityVerified('VERIFIED')).toBe(true);
    for (const s of ['FAILED', 'INCONCLUSIVE', 'NOT_TESTED'] as const) {
      expect(mayClaimCapacityVerified(s)).toBe(false);
    }
  });
});

describe('a storage result is derived from the measurement, not chosen', () => {
  it('fails a counterfeit drive that holds a fraction of its claim', () => {
    expect(deriveStorageResult(128, 8)).toBe('FAIL');
    expect(capacityRatio(128, 8)).toBeCloseTo(0.0625);
  });

  it('passes an honest drive despite the GB/GiB shortfall', () => {
    expect(deriveStorageResult(64, 59.6)).toBe('PASS');
  });

  it('is INCONCLUSIVE — never PASS — when nothing was measured', () => {
    expect(deriveStorageResult(64, null)).toBe('INCONCLUSIVE');
    const v = validateStorageTest({
      productId: 'p1', claimedCapacityGb: 64, method: 'CAPACITY_REPORT_ONLY',
      tester: 'QA', testedAt: '2026-08-13',
    });
    expect(v.ok && v.input.result).toBe('INCONCLUSIVE');
  });

  it('ignores an operator-supplied result and computes its own', () => {
    const v = validateStorageTest({
      productId: 'p1', claimedCapacityGb: 128, testedCapacityGb: 7.9,
      method: 'FULL_WRITE_VERIFY', tester: 'QA', testedAt: '2026-08-13',
      ...({ result: 'PASS' } as never),
    });
    expect(v.ok && v.input.result).toBe('FAIL');
  });

  it('requires a tester — an anonymous test is not evidence', () => {
    const v = validateStorageTest({
      productId: 'p1', claimedCapacityGb: 64, method: 'FULL_WRITE_VERIFY', tester: '  ', testedAt: '2026-08-13',
    });
    expect(v.ok === false && v.code).toBe('EVIDENCE_REQUIRED');
  });
});

// ── Product lifecycle ───────────────────────────────────────────────────────

describe('product lifecycle SEO refuses destructive defaults', () => {
  it('keeps a temporarily out-of-stock product on its own URL at 200', () => {
    const out = lifecycleSeoOutcome({ state: 'TEMPORARILY_OUT_OF_STOCK', disposition: 'RETAIN_200' });
    expect(out.httpStatus).toBe(200);
    expect(out.indexable).toBe(true);
    expect(out.redirectToProductId).toBeNull();
  });

  it('never offers a redirect for a product with no successor', () => {
    expect(allowedDispositionsFor('DISCONTINUED_NO_SUCCESSOR')).not.toContain('REDIRECT_301_SUCCESSOR');
  });

  it('rejects a 301 without a successor product', () => {
    const v = validateLifecycleDecision({
      productId: 'p1', state: 'DISCONTINUED_WITH_SUCCESSOR',
      disposition: 'REDIRECT_301_SUCCESSOR', rationale: 'replaced by the v2',
    });
    expect(v.ok === false && v.code).toBe('SUCCESSOR_REQUIRED');
    expect(v.ok === false && v.message).toMatch(/soft 404/i);
  });

  it('rejects a decision with no rationale', () => {
    const v = validateLifecycleDecision({
      productId: 'p1', state: 'DISCONTINUED_NO_SUCCESSOR', disposition: 'OFFER_ALTERNATIVE',
    });
    expect(v.ok === false && v.code).toBe('RATIONALE_REQUIRED');
  });

  it('rejects an indefensible disposition for the state', () => {
    const v = validateLifecycleDecision({
      productId: 'p1', state: 'TEMPORARILY_OUT_OF_STOCK', disposition: 'GONE_410', rationale: 'tidying up',
    });
    expect(v.ok === false && v.code).toBe('DISPOSITION_NOT_DEFENSIBLE');
  });

  it('refuses a blanket redirect of many products to one destination', () => {
    const decisions = ['a', 'b', 'c'].map((id) => ({
      productId: id, state: 'DISCONTINUED_WITH_SUCCESSOR', disposition: 'REDIRECT_301_SUCCESSOR',
      successorProductId: 'catch-all', rationale: 'x',
    }));
    const r = rejectBlanketRedirect(decisions as never);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/blanket redirect/i);
  });

  it('allows genuine per-product successors in one batch', () => {
    const decisions = ['a', 'b', 'c'].map((id, i) => ({
      productId: id, state: 'DISCONTINUED_WITH_SUCCESSOR', disposition: 'REDIRECT_301_SUCCESSOR',
      successorProductId: `successor-${i}`, rationale: 'x',
    }));
    expect(rejectBlanketRedirect(decisions as never).ok).toBe(true);
  });

  it('keeps a discontinued-with-alternatives page indexable — it still answers the query', () => {
    const out = lifecycleSeoOutcome({ state: 'DISCONTINUED_NO_SUCCESSOR', disposition: 'OFFER_ALTERNATIVE' });
    expect(out.httpStatus).toBe(200);
    expect(out.indexable).toBe(true);
    expect(out.showAlternatives).toBe(true);
    expect(out.notice).toMatch(/no longer stock/i);
  });

  it('does nothing at all to an UNDECIDED product', () => {
    const out = lifecycleSeoOutcome({ state: 'ACTIVE', disposition: 'UNDECIDED' });
    expect(out).toMatchObject({ httpStatus: 200, redirectToProductId: null, indexable: true, notice: null });
  });

  it('suggests without deciding, and every state has a defensible option', () => {
    for (const state of LIFECYCLE_STATES) {
      expect(allowedDispositionsFor(state)).toContain(suggestedDisposition(state));
      expect(allowedDispositionsFor(state)).toContain('UNDECIDED');
    }
  });
});

// ── Wiring ──────────────────────────────────────────────────────────────────

describe('catalogue intelligence is wired end to end', () => {
  const migration = read('apps/api/src/infrastructure/db/migrations/0119_seo_catalogue_intelligence.sql');
  const routes = read('apps/api/src/interfaces/http/routes/admin/seo-catalogue.ts');
  const publicRoutes = read('apps/api/src/interfaces/http/routes/seo.ts');
  const app = read('apps/api/src/interfaces/http/app.ts');

  it('enforces the evidence rules at the data layer too', () => {
    expect(migration).toContain("status <> 'VERIFIED' OR evidence_source IS NOT NULL");
    expect(migration).toContain("disposition NOT IN ('REDIRECT_301_SUCCESSOR','REDIRECT_301_REPLACEMENT') OR successor_product_id IS NOT NULL");
  });

  it('registers migration 0119 in the journal', () => {
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    const entry = journal.entries.find((e: any) => e.tag === '0119_seo_catalogue_intelligence');
    expect(entry).toBeTruthy();
    const prior = journal.entries.find((e: any) => e.idx === entry.idx - 1);
    expect(entry.when).toBeGreaterThan(prior.when);
  });

  it('exports the schema from the barrel so drizzle sees it', () => {
    expect(read('apps/api/src/infrastructure/db/schema/index.ts')).toContain("export * from './seo-catalogue'");
  });

  it('guards every admin handler with a permission', () => {
    const handlers = routes.match(/routes\.(get|post|delete|patch)\(/g) ?? [];
    const guards = routes.match(/requirePermissions\(/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    expect(guards).toHaveLength(handlers.length);
  });

  it('audits every mutation', () => {
    for (const action of ['SEO_BATTERY_COMPAT_RECORDED', 'SEO_STORAGE_TEST_RECORDED', 'SEO_PRODUCT_LIFECYCLE_DECIDED']) {
      expect(routes).toContain(action);
    }
  });

  it('mounts the admin and public routes', () => {
    expect(app).toContain("app.route('/admin/seo/catalogue', adminSeoCatalogueRoutes)");
    expect(app).toContain("'/admin/seo/catalogue'");
    expect(publicRoutes).toContain("routes.get('/battery-finder'");
  });

  it('never selects a cost or supplier column on the public finder path', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleSeoCatalogueRepository.ts');
    const publicQuery = repo.slice(repo.indexOf('searchBatteryCompat'), repo.indexOf('recordFinderEvent'));
    expect(publicQuery).not.toMatch(/cost|supplier|dealer|margin/i);
  });

  it('keeps the public finder page noindex until it is genuinely useful', () => {
    const page = read('apps/web/src/pages/battery-finder.astro');
    expect(page).toContain("robotsMeta = indexable ? undefined : 'noindex,follow'");
    expect(page).toMatch(/have not checked/i);
  });
});
