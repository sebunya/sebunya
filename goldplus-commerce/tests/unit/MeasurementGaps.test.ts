import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DismissMeasurementDlqUseCase,
  DLQ_DISMISSED_NOTE_PREFIX,
} from '../../apps/api/src/application/use-cases/measurement/DismissMeasurementDlqUseCase';
import { ListMeasurementDlqUseCase } from '../../apps/api/src/application/use-cases/measurement/ListMeasurementDlqUseCase';
import type { DlqRepository } from '../../apps/api/src/application/ports/measurement/DlqRepository';
import { summariseMatchQuality } from '../../apps/api/src/infrastructure/measurement/DrizzleAttributionRepository';
import {
  assistedOrdersByChannel,
  buildWeeklyChannelReport,
  reportWeeks,
  type CreditRow,
} from '../../apps/api/src/domain/measurement/ChannelReport';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

function fakeDlq(over: Partial<DlqRepository> = {}): DlqRepository {
  return {
    getUnresolvedCount: vi.fn(async () => 0),
    listUnresolved: vi.fn(async () => []),
    findById: vi.fn(async (id: string) => ({ id, eventId: 'e1', payload: {}, isResolved: false, failedAt: new Date() })),
    markResolved: vi.fn(async () => undefined),
    markDismissed: vi.fn(async () => true),
    ...over,
  };
}
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
const auditRepo = () => ({ save: vi.fn(async () => undefined) }) as any;

describe('DLQ dismiss', () => {
  it('requires a reason', async () => {
    const repo = fakeDlq();
    const uc = new DismissMeasurementDlqUseCase(repo, logger, auditRepo());
    await expect(uc.execute('d1', '  ', 'u1')).rejects.toThrow('INVALID_REASON');
    await expect(uc.execute('d1', undefined, 'u1')).rejects.toThrow('INVALID_REASON');
    expect(repo.markDismissed).not.toHaveBeenCalled();
  });

  it('stores the dismissal distinctly from a replay and does not re-enqueue', async () => {
    const repo = fakeDlq();
    const uc = new DismissMeasurementDlqUseCase(repo, logger, auditRepo());
    await uc.execute('d1', ' test order ', 'u1');
    expect(repo.markDismissed).toHaveBeenCalledWith('d1', `${DLQ_DISMISSED_NOTE_PREFIX}test order`);
    expect(repo.markResolved).not.toHaveBeenCalled();
  });

  it('refuses an already resolved row, including one resolved concurrently', async () => {
    const resolved = fakeDlq({ findById: vi.fn(async () => ({ id: 'd1', eventId: 'e', payload: {}, isResolved: true, failedAt: new Date() })) });
    await expect(new DismissMeasurementDlqUseCase(resolved, logger, auditRepo()).execute('d1', 'dup', 'u1')).rejects.toThrow('ALREADY_RESOLVED');
    const raced = fakeDlq({ markDismissed: vi.fn(async () => false) });
    await expect(new DismissMeasurementDlqUseCase(raced, logger, auditRepo()).execute('d1', 'dup', 'u1')).rejects.toThrow('ALREADY_RESOLVED');
  });

  it('404s an unknown row', async () => {
    const repo = fakeDlq({ findById: vi.fn(async () => null) });
    await expect(new DismissMeasurementDlqUseCase(repo, logger, auditRepo()).execute('x', 'reason', 'u1')).rejects.toThrow('NOT_FOUND');
  });

  it('route uses the replay permission, the proxy allowlists it, the page has an inline form', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/measurement.ts');
    expect(route).toMatch(/routes\.post\('\/dlq\/:id\/dismiss', requirePermissions\(\[PERMISSIONS\.SETTINGS_MANAGE\]\)/);
    expect(route).toMatch(/routes\.post\('\/dlq\/:id\/replay', requirePermissions\(\[PERMISSIONS\.SETTINGS_MANAGE\]\)/);
    expect(route).toContain('MEASUREMENT_DLQ_DISMISSED');
    const proxy = read('apps/web/src/pages/api/admin/measurement/[...path].ts');
    expect(proxy).toMatch(/dismiss\$\/, queryAllowlist: \[\], forwardBody: true/);
    const page = read('apps/web/src/pages/admin/measurement/dlq.astro');
    expect(page).toContain('dismiss-form');
    expect(page).not.toMatch(/\b(confirm|prompt)\(/);
  });
});

describe('DLQ true unresolved total', () => {
  it('returns the count, not the capped page length', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, eventName: 'purchase', eventId: `e${i}`, totalAttempts: 5, failedReason: 'x', failedAt: new Date() }));
    const repo = fakeDlq({ listUnresolved: vi.fn(async () => rows), getUnresolvedCount: vi.fn(async () => 437) });
    const out = await new ListMeasurementDlqUseCase(repo).executeWithTotal(100);
    expect(out.items).toHaveLength(100);
    expect(out.total).toBe(437);
  });
});

describe('match quality counts and signal coverage', () => {
  it('no events: counts 0, coverage null (no data, never 0%)', () => {
    const s = summariseMatchQuality({ total: 0, avg: null, below40: 0, above80: 0 });
    expect(s.below40Count).toBe(0);
    expect(s.signalCoverage.hashedEmail).toBeNull();
    expect(s.signalCoverage.ttclid).toBeNull();
  });
  it('events: counts and per-signal percentages', () => {
    const s = summariseMatchQuality({
      total: 8, avg: 61, below40: 2, above80: 3,
      signals: { hashedEmail: 6, hashedPhone: 2, fbp: 8, fbc: 1, gclid: 0, ttclid: 4, ipAddress: 7 },
    });
    expect(s).toMatchObject({ below40Count: 2, above80Count: 3, below40Pct: 25, above80Pct: 38 });
    expect(s.signalCoverage).toEqual({ hashedEmail: 75, hashedPhone: 25, fbp: 100, fbc: 13, gclid: 0, ttclid: 50, ipAddress: 88 });
  });
  it('attribution page uses the tower bands (80/60/40)', () => {
    const page = read('apps/web/src/pages/admin/measurement/attribution.astro');
    expect(page).toMatch(/score >= 80\) return 'score-high'/);
    expect(page).toMatch(/score >= 60\) return 'score-good'/);
    expect(page).not.toMatch(/score >= 70/);
    for (const k of ['hashedEmail', 'hashedPhone', 'fbp', 'fbc', 'gclid', 'ttclid', 'ipAddress']) expect(page).toContain(`data-signal="${k}"`);
  });
});

describe('assisted orders', () => {
  const cr = (orderId: string, channel: string, weight = 1, basis: 'observed' | 'declared' = 'observed'): CreditRow =>
    ({ orderId, channel, detail: '', weight, creditedUGX: 0n, basis });

  it('counts channels in the journey that did not win the last click, once per order', () => {
    const journey = [cr('o1', 'paid_social', 0.5), cr('o1', 'email', 0.5), cr('o2', 'paid_social', 1), cr('o3', 'email', 0.5), cr('o3', 'email', 0.5)];
    const last = [cr('o1', 'email'), cr('o2', 'paid_social'), cr('o3', 'paid_search')];
    const m = assistedOrdersByChannel({ journeyCredits: journey, lastClickCredits: last }, () => true);
    expect(m.get('paid_social')).toBe(1);
    expect(m.get('email')).toBe(1);
    expect(m.has('paid_search')).toBe(false);
  });

  it('ignores declared answers and out-of-scope orders', () => {
    const m = assistedOrdersByChannel({
      journeyCredits: [cr('o1', 'word_of_mouth', 1, 'declared'), cr('o2', 'email')],
      lastClickCredits: [cr('o1', 'direct'), cr('o2', 'direct')],
    }, (id) => id !== 'o2');
    expect(m.size).toBe(0);
  });

  it('the weekly report carries assistedOrders per channel', () => {
    const weeks = reportWeeks(new Date('2026-09-23T12:00:00Z'), 1);
    const at = new Date('2026-09-22T12:00:00Z');
    const sales = [{ orderId: 'o1', orderAt: at, revenueUGX: 1000n }];
    const last = [{ ...cr('o1', 'email'), creditedUGX: 1000n }];
    const r = buildWeeklyChannelReport({
      model: 'last_click', weeks, sales, credits: last, spend: { status: 'NOT_AVAILABLE' },
      assist: { journeyCredits: [cr('o1', 'paid_social', 0.5), cr('o1', 'email', 0.5)], lastClickCredits: last },
    });
    expect(r.channels.find((c) => c.channel === 'email')?.assistedOrders).toBe(0);
    expect(r.channels.find((c) => c.channel === 'paid_social')).toMatchObject({ orders: 0, assistedOrders: 1 });
    const noAssist = buildWeeklyChannelReport({ model: 'last_click', weeks, sales, credits: last, spend: { status: 'NOT_AVAILABLE' } });
    expect(noAssist.channels[0]?.assistedOrders).toBeNull();
  });
});

describe('UTM builder campaign picker', () => {
  it('saves through the existing campaign UTM endpoint and keeps the plain builder', () => {
    const page = read('apps/web/src/pages/admin/utm-builder/index.astro');
    expect(page).toContain('/admin/campaigns/${encodeURIComponent(campaignId)}/utm-links');
    expect(page).toContain('campaignName: q.get("utm_campaign")');
    expect(page).toContain('No campaign — just build the link');
  });
});
