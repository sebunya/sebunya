import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';

const operations = vi.hoisted(() => ({
  overview: vi.fn(), definitions: vi.fn(), definition: vi.fn(), executions: vi.fn(), execution: vi.fn(),
  createDefinition: vi.fn(), createVersion: vi.fn(), submit: vi.fn(), decide: vi.fn(), transition: vi.fn(),
  dryRun: vi.fn(), manualExecute: vi.fn(), replay: vi.fn(), reconcile: vi.fn(), newCorrelationId: vi.fn(() => 'correlation-a4'),
}));

vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: { getInstance: () => ({ automationOperationsUseCase: operations }) },
}));
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } }, 401);
    const permissions = auth === 'Bearer all' ? Object.values(PERMISSIONS)
      : auth === 'Bearer read' ? [PERMISSIONS.AUTOMATION_READ]
      : auth === 'Bearer execute' ? [PERMISSIONS.AUTOMATION_EXECUTE]
      : [];
    c.set('user', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'operator@fixture.local', permissions });
    await next();
  },
}));

import app from '../../apps/api/src/interfaces/http/app';

const all = { Authorization: 'Bearer all', 'Content-Type': 'application/json' };
const read = { Authorization: 'Bearer read' };
const execution = { Authorization: 'Bearer execute', 'Content-Type': 'application/json' };

describe('Automation A4 protected operating API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operations.overview.mockResolvedValue({ activeAutomations: 0, pausedAutomations: 0, pendingApprovals: 0, executions: {}, suppressionsByReason: {}, oldestQueuedAgeSeconds: null, averagePlanningDurationMs: null, averageExecutionDurationMs: null, nextScheduledRun: null, providerReadiness: { queuedIntents: 0, attempted: 0, succeeded: 0, ambiguous: 0 } });
    operations.definitions.mockResolvedValue({ items: [], total: 0 });
    operations.executions.mockResolvedValue({ items: [], total: 0 });
    operations.definition.mockResolvedValue(null);
    operations.execution.mockResolvedValue(null);
  });

  it('requires authentication and exact read permission', async () => {
    expect((await app.request('/admin/automation/overview')).status).toBe(401);
    expect((await app.request('/admin/automation/overview', { headers: { Authorization: 'Bearer forbidden' } })).status).toBe(403);
    const response = await app.request('/admin/automation/overview', { headers: read });
    expect(response.status).toBe(200);
    expect(operations.overview).toHaveBeenCalledOnce();
  });

  it('keeps reconciliation separately privileged from read and execute', async () => {
    const body = JSON.stringify({ actionExecutionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', resolution: 'FAILED', reason: 'Provider ledger checked', evidence: 'provider-case-42' });
    expect((await app.request('/admin/automation/executions/cccccccc-cccc-4ccc-8ccc-cccccccccccc/reconcile', { method: 'POST', headers: { ...read, 'Content-Type': 'application/json' }, body })).status).toBe(403);
    expect((await app.request('/admin/automation/executions/cccccccc-cccc-4ccc-8ccc-cccccccccccc/reconcile', { method: 'POST', headers: execution, body })).status).toBe(403);
    expect(operations.reconcile).not.toHaveBeenCalled();
  });

  it('validates immutable version input before the use case', async () => {
    const response = await app.request('/admin/automation/definitions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/versions', {
      method: 'POST', headers: all, body: JSON.stringify({ expectedVersion: 0, config: { triggerFamily: 'MANUAL_ADMIN', actions: [] } }),
    });
    expect(response.status).toBe(400);
    expect(operations.createVersion).not.toHaveBeenCalled();
  });

  it('maps draft creation and dry-run to use cases without transport', async () => {
    operations.createDefinition.mockResolvedValue({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Lifecycle review', status: 'DRAFT' });
    operations.dryRun.mockResolvedValue({ executionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', duplicate: false, providerCalls: 0 });
    const created = await app.request('/admin/automation/definitions', { method: 'POST', headers: all, body: JSON.stringify({ name: 'Lifecycle review' }) });
    expect(created.status).toBe(201);
    const dryRun = await app.request('/admin/automation/definitions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dry-run', { method: 'POST', headers: all, body: JSON.stringify({ subjectId: null }) });
    expect(dryRun.status).toBe(200);
    expect((await dryRun.json() as any).data.providerCalls).toBe(0);
  });

  it('exposes empty and not-found states truthfully', async () => {
    const list = await app.request('/admin/automation/definitions', { headers: read });
    expect((await list.json() as any).data).toEqual({ items: [], total: 0 });
    const detail = await app.request('/admin/automation/definitions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { headers: read });
    expect(detail.status).toBe(404);
    expect((await detail.json() as any).error.code).toBe('AUTOMATION_NOT_FOUND');
  });
});
