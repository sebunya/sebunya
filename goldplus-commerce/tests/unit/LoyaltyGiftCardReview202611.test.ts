import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Fixes from the 2026-11 gift card / store credit / loyalty review that are best proven by their wiring. */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('manual points adjustment', () => {
  it('needs a fresh step-up, like creating store credit', () => {
    const routes = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
    const line = routes.split('\n').find((l) => l.startsWith("routes.post('/adjust'"))!;
    expect(line).toContain("requireStepUp('payment_refund')");
    expect(read('apps/web/src/pages/admin/loyalty/adjustments.astro')).toContain('MFA_STEP_UP_REQUIRED');
  });
});

describe('credit expiry typed by an admin', async () => {
  const { parseCreditExpiry } = await import('../../apps/api/src/domain/credit/CreditInstrument');
  const now = new Date('2026-11-01T10:00:00Z');
  it('refuses a date that cannot be read instead of issuing credit that never expires', () => {
    for (const bad of ['2026-13-40', '31/12/2026', '2027-02-30', 'soon']) {
      expect(parseCreditExpiry(bad, now)).toMatchObject({ ok: false, code: 'BAD_EXPIRY' });
    }
  });
  it('empty is no expiry; a day is valid through that day in Kampala; the past is refused', () => {
    expect(parseCreditExpiry('', now)).toEqual({ ok: true, expiresAt: null });
    expect(parseCreditExpiry(undefined, now)).toEqual({ ok: true, expiresAt: null });
    expect(parseCreditExpiry('2026-12-31', now)).toEqual({ ok: true, expiresAt: new Date('2026-12-31T20:59:59Z') });
    expect(parseCreditExpiry('2026-10-31', now)).toMatchObject({ ok: false, message: 'The expiry date is in the past.' });
  });
});

describe('permission registry sync', () => {
  it('seeds a governance role once, by a marker, so a role emptied on purpose stays empty', () => {
    const src = read('apps/api/src/infrastructure/security/PermissionRegistrySync.ts');
    const loop = src.slice(src.indexOf('for (const roleName of GOVERNANCE_ROLES)'), src.indexOf('// Top up (never trim)'));
    // The marker is read before "holds nothing" is even looked at, and every outcome writes one.
    expect(loop.indexOf('BASELINE_SEEDED_ACTION')).toBeGreaterThan(-1);
    expect(loop.indexOf('if (marked) continue;')).toBeLessThan(loop.indexOf('.from(rolePermissions)'));
    expect(loop.match(/markSeeded\(/g)?.length).toBe(2); // written for a role that already holds grants, and after a seed
  });
});

describe('loyalty daily ticker', () => {
  it('a failing step does not stop the steps after it', async () => {
    const { vi } = await import('vitest');
    vi.doMock('../../apps/api/src/infrastructure/Registry', () => ({ Registry: { getInstance: () => ({}) } }));
    const { runLoyaltySweepOnce } = await import('../../apps/api/src/infrastructure/scheduler/LoyaltyDailyTicker');
    const ran: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const summary = await runLoyaltySweepOnce({
      runLoyaltyDailySweepUseCase: { execute: async () => { throw new Error('statement timeout'); } },
      awardBirthdayPointsUseCase: { execute: async () => { ran.push('birthdays'); return { awarded: 0 }; } },
      catchUpMissionAwardsUseCase: { execute: async () => { ran.push('missions'); throw new Error('boom'); } },
      evaluateTiersUseCase: { execute: async () => { ran.push('tiers'); return { evaluated: 0, changed: 0 }; } },
      loyaltyDrawRepo: { expireTokensDueBefore: async () => { ran.push('draws'); return 0; } },
    } as never, async () => { ran.push('reconcile'); return { checked: 7, discrepancies: [] }; });
    expect(ran).toEqual(['birthdays', 'missions', 'tiers', 'draws', 'reconcile']);
    expect(summary.sweep).toEqual({ error: 'statement timeout' });
    expect(summary.missions).toEqual({ error: 'boom' });
    log.mockRestore(); err.mockRestore();
    vi.doUnmock('../../apps/api/src/infrastructure/Registry');
  });
});

describe('loyalty and gift card pages', () => {
  const loyalty = read('apps/web/src/pages/loyalty.astro');
  const terms = read('apps/web/src/pages/loyalty-terms.astro');
  it('no streak is advertised when the engine has no streak window (streaks off)', () => {
    expect(read('apps/api/src/interfaces/http/routes/commerce.ts')).toContain('streak: streakMission && programme.streakWindowDays !== null');
    for (const page of [loyalty, terms]) {
      expect(page).not.toContain('windowDays ?? 90');
      expect(page).toContain('src.streak.windowDays != null');
    }
  });
  it('the terms never print a bare 0 from a numeric && guard', () => {
    expect(terms).not.toMatch(/\{\(src\?\.verificationScan[^}]*\) && \(/);
    expect(terms).not.toMatch(/\{src\?\.(verificationScan|counterfeitReport|phoneVerification|birthday) && \(/);
    expect(terms).toContain('{!!(src?.verificationScan');
  });
  it('/loyalty says signed-out orders on the verified phone earn too, as the terms do', () => {
    expect(terms).toContain('signed out with the phone number verified on your account');
    expect(loyalty).not.toMatch(/placed while signed in/i);
    expect(loyalty).toContain('signed out with the phone number verified on your account');
  });
  it('the buy page gives the pay buttons back when Back restores it from the cache', () => {
    const buy = read('apps/web/src/pages/gift-card/buy.astro');
    expect(buy).toMatch(/addEventListener\('pageshow', \(e\) => \{\s*if \(!e\.persisted\) return;/);
    expect(buy).toContain("removeAttribute('disabled')");
  });
  it('the scratch panel keeps what was scratched across a resize', () => {
    const open = read('apps/web/src/pages/gift-card/open.astro');
    expect(open).not.toContain("window.addEventListener('resize', () => { if (!revealed) paint(); });");
    expect(open).toContain("ctx.globalCompositeOperation = 'destination-in';");
  });
});

describe('finance CSV', async () => {
  const { csvCell, csvDate } = await import('../../apps/api/src/interfaces/http/csv');
  it('writes dates as ISO 8601 through the one CSV writer', () => {
    expect(csvCell(new Date('2026-11-01T00:00:00Z'))).toBe('"2026-11-01T00:00:00.000Z"');
    expect(csvDate(new Date('2026-11-01T00:00:00Z'))).toBe('"2026-11-01"');
    expect(csvCell(new Date('nope'))).toBe('""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });
  it('the loyalty finance export goes through csvCell/csvDate', () => {
    const routes = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
    const block = routes.slice(routes.indexOf("routes.get('/finance-export.csv'"), routes.indexOf("routes.post('/accounts/merge'"));
    expect(block).toContain('csvDate(v)');
    expect(block).not.toContain("r[k] ?? ''");
  });
});
