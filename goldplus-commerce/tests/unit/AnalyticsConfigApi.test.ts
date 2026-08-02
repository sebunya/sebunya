import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';
import {
  EvaluateAnalyticsAlertRulesUseCase,
  ExportAnalyticsUseCase,
  ManageAnalyticsAlertRulesUseCase,
  ManageAnalyticsSavedViewsUseCase,
  MAX_ALERT_RULES_PER_OWNER,
  MAX_SAVED_VIEWS_PER_OWNER,
} from '../../apps/api/src/application/use-cases/analytics/AnalyticsConfigUseCases';

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const registry = vi.hoisted(() => ({
  auditRepo: {},
  manageAnalyticsSavedViewsUseCase: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  manageAnalyticsAlertRulesUseCase: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  evaluateAnalyticsAlertRulesUseCase: { execute: vi.fn() },
  exportAnalyticsUseCase: { execute: vi.fn() },
  getAnalyticsOverviewUseCase: { execute: vi.fn() },
  getAnalyticsMetricSeriesUseCase: { execute: vi.fn() },
  getAnalyticsDataQualityUseCase: { execute: vi.fn() },
}));

const auditExecute = vi.hoisted(() => vi.fn());

vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: { getInstance: () => registry },
}));
vi.mock('../../apps/api/src/application/use-cases/audit/CreateAuditLogUseCase', () => ({
  CreateAuditLogUseCase: class { execute = auditExecute; },
}));
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth) return c.json({ success: false }, 401);
    const map: Record<string, string[]> = {
      read: [PERMISSIONS.ANALYTICS_READ],
      manage: [PERMISSIONS.ANALYTICS_READ, PERMISSIONS.ANALYTICS_MANAGE],
      alerts: [PERMISSIONS.ANALYTICS_READ, PERMISSIONS.ANALYTICS_ALERTS_MANAGE],
      export: [PERMISSIONS.ANALYTICS_READ, PERMISSIONS.ANALYTICS_EXPORT],
      all: Object.values(PERMISSIONS),
    };
    c.set('user', { id: OWNER, permissions: map[auth.replace('Bearer ', '')] ?? [] });
    await next();
  },
}));

import app from '../../apps/api/src/interfaces/http/app';

const json = (body: unknown, token: string, method = 'POST') => ({
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('analytics configuration API permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.manageAnalyticsSavedViewsUseCase.list.mockResolvedValue([]);
    registry.manageAnalyticsAlertRulesUseCase.list.mockResolvedValue([]);
    registry.manageAnalyticsSavedViewsUseCase.create.mockResolvedValue({ ok: true, data: { id: 'v1', name: 'n', scope: 'PRIVATE', metricKeys: ['orders'] } });
    registry.manageAnalyticsAlertRulesUseCase.create.mockResolvedValue({ ok: true, data: { id: 'r1', name: 'n', metricKey: 'orders', comparison: 'ABOVE', threshold: 1, minimumSample: 5 } });
    registry.exportAnalyticsUseCase.execute.mockResolvedValue({ ok: true, data: { rowCount: 2, period: { startDay: '2026-08-01', endDay: '2026-08-02', days: 2 }, timezone: 'Africa/Kampala' } });
    registry.evaluateAnalyticsAlertRulesUseCase.execute.mockResolvedValue({ evaluatedAt: 'x', outcomes: [] });
  });

  it('separates read from manage: analytics.read cannot create a saved view', async () => {
    expect((await app.request('/admin/analytics/saved-views', { headers: { Authorization: 'Bearer read' } })).status).toBe(200);
    expect((await app.request('/admin/analytics/saved-views', json({ name: 'x' }, 'read'))).status).toBe(403);
    expect(registry.manageAnalyticsSavedViewsUseCase.create).not.toHaveBeenCalled();
    expect((await app.request('/admin/analytics/saved-views', json({ name: 'x', metricKeys: ['orders'], periodDays: 30 }, 'manage'))).status).toBe(201);
  });

  it('keeps alert-rule management separately privileged from view management', async () => {
    expect((await app.request('/admin/analytics/alert-rules', json({ name: 'x' }, 'manage'))).status).toBe(403);
    expect(registry.manageAnalyticsAlertRulesUseCase.create).not.toHaveBeenCalled();
    expect((await app.request('/admin/analytics/alert-rules', json({ name: 'x', metricKey: 'orders', comparison: 'ABOVE', threshold: 1 }, 'alerts'))).status).toBe(201);
  });

  it('keeps export separately privileged', async () => {
    expect((await app.request('/admin/analytics/exports', json({}, 'manage'))).status).toBe(403);
    expect(registry.exportAnalyticsUseCase.execute).not.toHaveBeenCalled();
    expect((await app.request('/admin/analytics/exports', json({}, 'export'))).status).toBe(200);
  });

  it('requires authentication on every configuration endpoint', async () => {
    for (const [path, method] of [
      ['/admin/analytics/saved-views', 'GET'],
      ['/admin/analytics/alert-rules', 'GET'],
      ['/admin/analytics/alert-rules/evaluations', 'GET'],
      ['/admin/analytics/exports', 'POST'],
    ] as const) {
      expect((await app.request(path, { method })).status, path).toBe(401);
    }
  });

  it('audits every configuration mutation and the export', async () => {
    await app.request('/admin/analytics/saved-views', json({ name: 'x', metricKeys: ['orders'], periodDays: 30 }, 'manage'));
    await app.request('/admin/analytics/alert-rules', json({ name: 'x', metricKey: 'orders', comparison: 'ABOVE', threshold: 1 }, 'alerts'));
    await app.request('/admin/analytics/exports', json({}, 'export'));
    const actions = auditExecute.mock.calls.map((call) => call[0].action);
    expect(actions).toEqual([
      'ANALYTICS_SAVED_VIEW_CREATED',
      'ANALYTICS_ALERT_RULE_CREATED',
      'ANALYTICS_EXPORTED',
    ]);
  });

  it('does not audit a refused mutation', async () => {
    registry.manageAnalyticsSavedViewsUseCase.create.mockResolvedValue({ ok: false, code: 'DUPLICATE_NAME', message: 'dup' });
    const response = await app.request('/admin/analytics/saved-views', json({ name: 'x', metricKeys: ['orders'], periodDays: 30 }, 'manage'));
    expect(response.status).toBe(409);
    expect(auditExecute).not.toHaveBeenCalled();
  });
});

// ── Use-case level: validation, ownership, limits, evaluation ──────────────

function savedViewRepoStub() {
  const rows: any[] = [];
  return {
    rows,
    listVisibleTo: vi.fn(async (ownerId: string) => rows.filter((r) => r.ownerId === ownerId || r.scope === 'SHARED')),
    findVisible: vi.fn(async (id: string, ownerId: string) => rows.find((r) => r.id === id && (r.ownerId === ownerId || r.scope === 'SHARED')) ?? null),
    create: vi.fn(async (draft: any) => { const row = { id: `v${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...draft }; rows.push(row); return row; }),
    updateOwned: vi.fn(async (id: string, ownerId: string, patch: any) => {
      const row = rows.find((r) => r.id === id && r.ownerId === ownerId);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    }),
    deleteOwned: vi.fn(async (id: string, ownerId: string) => {
      const index = rows.findIndex((r) => r.id === id && r.ownerId === ownerId);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    }),
    countOwnedBy: vi.fn(async (ownerId: string) => rows.filter((r) => r.ownerId === ownerId).length),
  };
}

describe('ManageAnalyticsSavedViewsUseCase', () => {
  it('rejects metric keys that are not in the canonical catalogue', async () => {
    const useCase = new ManageAnalyticsSavedViewsUseCase(savedViewRepoStub() as any);
    const result = await useCase.create({ ownerId: OWNER, name: 'v', metricKeys: ['orders', 'made_up_metric'], periodDays: 30 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('made_up_metric');
  });

  it('requires a window and validates it', async () => {
    const useCase = new ManageAnalyticsSavedViewsUseCase(savedViewRepoStub() as any);
    expect((await useCase.create({ ownerId: OWNER, name: 'v', metricKeys: ['orders'] })).ok).toBe(false);
    const reversed = await useCase.create({ ownerId: OWNER, name: 'v', metricKeys: ['orders'], startDay: '2026-08-03', endDay: '2026-08-02' });
    expect(reversed.ok).toBe(false);
  });

  it('refuses another operator’s private view as NOT_FOUND, never as forbidden', async () => {
    const repo = savedViewRepoStub();
    const useCase = new ManageAnalyticsSavedViewsUseCase(repo as any);
    const created = await useCase.create({ ownerId: OTHER, name: 'theirs', metricKeys: ['orders'], periodDays: 7, scope: 'PRIVATE' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const read = await useCase.get(created.data.id, OWNER);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe('NOT_FOUND');
    const update = await useCase.update(created.data.id, OWNER, { name: 'hijacked' });
    expect(update.ok).toBe(false);
    expect(repo.rows[0].name).toBe('theirs');
  });

  it('shows shared views to other operators', async () => {
    const repo = savedViewRepoStub();
    const useCase = new ManageAnalyticsSavedViewsUseCase(repo as any);
    await useCase.create({ ownerId: OTHER, name: 'shared', metricKeys: ['orders'], periodDays: 7, scope: 'SHARED' });
    expect(await useCase.list(OWNER)).toHaveLength(1);
  });

  it('enforces the per-owner limit', async () => {
    const repo = savedViewRepoStub();
    repo.countOwnedBy = vi.fn(async () => MAX_SAVED_VIEWS_PER_OWNER) as any;
    const useCase = new ManageAnalyticsSavedViewsUseCase(repo as any);
    const result = await useCase.create({ ownerId: OWNER, name: 'v', metricKeys: ['orders'], periodDays: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('LIMIT_REACHED');
  });
});

function alertRepoStub() {
  const rows: any[] = [];
  return {
    rows,
    listOwnedBy: vi.fn(async (ownerId: string) => rows.filter((r) => r.ownerId === ownerId)),
    findOwned: vi.fn(async (id: string, ownerId: string) => rows.find((r) => r.id === id && r.ownerId === ownerId) ?? null),
    create: vi.fn(async (draft: any) => { const row = { id: `r${rows.length + 1}`, enabled: true, lastFiredAt: null, lastEvaluatedAt: null, createdAt: new Date(), updatedAt: new Date(), ...draft }; rows.push(row); return row; }),
    updateOwned: vi.fn(async (id: string, ownerId: string, patch: any) => {
      const row = rows.find((r) => r.id === id && r.ownerId === ownerId);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    }),
    deleteOwned: vi.fn(async () => true),
    countOwnedBy: vi.fn(async (ownerId: string) => rows.filter((r) => r.ownerId === ownerId).length),
    listEnabled: vi.fn(async () => rows.filter((r) => r.enabled)),
    recordEvaluation: vi.fn(async () => {}),
  };
}

describe('ManageAnalyticsAlertRulesUseCase', () => {
  const base = { ownerId: OWNER, name: 'failures', metricKey: 'payment_failure_rate', comparison: 'ABOVE' as const, threshold: 0.2 };

  it('rejects unknown metrics and out-of-range rate thresholds', async () => {
    const useCase = new ManageAnalyticsAlertRulesUseCase(alertRepoStub() as any);
    expect((await useCase.create({ ...base, metricKey: 'nope' })).ok).toBe(false);
    expect((await useCase.create({ ...base, threshold: 4 })).ok).toBe(false);
  });

  it('raises a too-low minimum sample to the catalogue floor instead of accepting it', async () => {
    const repo = alertRepoStub();
    const useCase = new ManageAnalyticsAlertRulesUseCase(repo as any);
    const result = await useCase.create({ ...base, minimumSample: 1 });
    expect(result.ok).toBe(true);
    // payment_failure_rate declares minimumSample 5 in the catalogue.
    if (result.ok) expect(result.data.minimumSample).toBe(5);
  });

  it('enforces the per-owner limit', async () => {
    const repo = alertRepoStub();
    repo.countOwnedBy = vi.fn(async () => MAX_ALERT_RULES_PER_OWNER) as any;
    const useCase = new ManageAnalyticsAlertRulesUseCase(repo as any);
    const result = await useCase.create(base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('LIMIT_REACHED');
  });

  it('will not let one operator edit another’s rule', async () => {
    const repo = alertRepoStub();
    const useCase = new ManageAnalyticsAlertRulesUseCase(repo as any);
    const created = await useCase.create({ ...base, ownerId: OTHER });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const update = await useCase.update(created.data.id, OWNER, { enabled: false });
    expect(update.ok).toBe(false);
    expect(repo.rows[0].enabled).toBe(true);
  });
});

function overviewStub(metric: { key: string; value: number | null; state: string; sampleSize: number | null }) {
  return {
    execute: vi.fn(async () => ({
      contractVersion: 'commerce-analytics-v2',
      generatedAt: '2026-08-02T00:00:00.000Z',
      period: { startDay: '2026-07-27', endDay: '2026-08-02', days: 7 },
      metrics: [{ ...metric, label: 'x', definition: 'x', unit: 'rate', polarity: 'INCREASE_IS_BAD', previousState: 'VALUE', previousValue: 0, absoluteChange: 0, relativeChange: 0, assessment: 'FLAT', source: 'orders', drilldownRoute: '/admin/orders' }],
      trend: [{ day: '2026-08-01', orders: 1, paidOrders: 1, paidOrderValueUgx: 10 }],
      engagement: {},
      actions: [],
      sourceFreshness: [],
      quality: { availableSources: 1, totalSources: 1, coverageRate: 1, status: 'HEALTHY', warnings: [] },
    })),
  } as any;
}

describe('EvaluateAnalyticsAlertRulesUseCase', () => {
  const rule = {
    id: 'r1', ownerId: OWNER, name: 'failure watch', metricKey: 'payment_failure_rate',
    comparison: 'ABOVE' as const, threshold: 0.2, minimumSample: 5, evaluationDays: 7,
    severity: 'HIGH' as const, enabled: true, cooldownMinutes: 720,
    lastEvaluatedAt: null, lastFiredAt: null, createdAt: new Date(), updatedAt: new Date(),
  };

  it('fires with evidence when the threshold is breached at sufficient sample', async () => {
    const repo = alertRepoStub();
    repo.listEnabled = vi.fn(async () => [rule]) as any;
    const useCase = new EvaluateAnalyticsAlertRulesUseCase(repo as any, overviewStub({ key: 'payment_failure_rate', value: 0.4, state: 'VALUE', sampleSize: 20 }));
    const { outcomes } = await useCase.execute(new Date('2026-08-02T00:00:00Z'));
    expect(outcomes[0]!.fired).toBe(true);
    expect(outcomes[0]!.reason).toBe('FIRED');
    expect(outcomes[0]!.action?.evidence).toContain('0.4');
    expect(outcomes[0]!.action?.sampleSize).toBe(20);
    expect(repo.recordEvaluation).toHaveBeenCalledWith('r1', expect.any(Date), true);
  });

  it('does not fire below the minimum sample even when the threshold is breached', async () => {
    const repo = alertRepoStub();
    repo.listEnabled = vi.fn(async () => [rule]) as any;
    const useCase = new EvaluateAnalyticsAlertRulesUseCase(repo as any, overviewStub({ key: 'payment_failure_rate', value: 0.9, state: 'VALUE', sampleSize: 2 }));
    const { outcomes } = await useCase.execute();
    expect(outcomes[0]!.fired).toBe(false);
    expect(outcomes[0]!.reason).toBe('INSUFFICIENT_SAMPLE');
    expect(outcomes[0]!.action).toBeNull();
  });

  it('does not fire on an unavailable metric', async () => {
    const repo = alertRepoStub();
    repo.listEnabled = vi.fn(async () => [rule]) as any;
    const useCase = new EvaluateAnalyticsAlertRulesUseCase(repo as any, overviewStub({ key: 'payment_failure_rate', value: null, state: 'SOURCE_UNAVAILABLE', sampleSize: null }));
    const { outcomes } = await useCase.execute();
    expect(outcomes[0]!.reason).toBe('NO_VALUE');
  });

  it('respects the cooldown so one sustained condition is one action', async () => {
    const repo = alertRepoStub();
    repo.listEnabled = vi.fn(async () => [{ ...rule, lastFiredAt: new Date('2026-08-02T00:00:00Z') }]) as any;
    const useCase = new EvaluateAnalyticsAlertRulesUseCase(repo as any, overviewStub({ key: 'payment_failure_rate', value: 0.4, state: 'VALUE', sampleSize: 20 }));
    const { outcomes } = await useCase.execute(new Date('2026-08-02T01:00:00Z'));
    expect(outcomes[0]!.fired).toBe(false);
    expect(outcomes[0]!.reason).toBe('IN_COOLDOWN');
  });

  it('never returns a delivery destination — evaluation is internal only', async () => {
    const repo = alertRepoStub();
    repo.listEnabled = vi.fn(async () => [rule]) as any;
    const useCase = new EvaluateAnalyticsAlertRulesUseCase(repo as any, overviewStub({ key: 'payment_failure_rate', value: 0.4, state: 'VALUE', sampleSize: 20 }));
    const { outcomes } = await useCase.execute();
    const serialised = JSON.stringify(outcomes);
    for (const forbidden of ['email', 'sms', 'whatsapp', 'webhook', 'recipient', 'destination', 'channel']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('ExportAnalyticsUseCase', () => {
  it('produces a bounded CSV with definitions and no customer fields', async () => {
    const useCase = new ExportAnalyticsUseCase(overviewStub({ key: 'payment_failure_rate', value: 0.1, state: 'VALUE', sampleSize: 10 }));
    const result = await useCase.execute({ exportedBy: OWNER, days: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.csv.split('\n')[0]).toBe('kampala_day,orders,paid_orders,paid_order_value_ugx');
    expect(result.data.rowCount).toBe(1);
    expect(result.data.definitions[0]!.formula.length).toBeGreaterThan(0);
    expect(result.data.timezone).toBe('Africa/Kampala');
    const serialised = JSON.stringify(result.data).toLowerCase();
    for (const forbidden of ['customer_name', 'customer_phone', 'customer_email', 'token', 'password']) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
