import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';

const operations = vi.hoisted(() => ({ overview: vi.fn(), list: vi.fn(), detail: vi.fn(), recordSignal: vi.fn(), assign: vi.fn(), decide: vi.fn() }));
vi.mock('../../apps/api/src/infrastructure/Registry', () => ({ Registry: { getInstance: () => ({ fraudTriageOperationsUseCase: operations }) } }));
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({ authMiddleware: async (c: any, next: any) => {
  const auth = c.req.header('Authorization'); if (!auth) return c.json({ success: false }, 401);
  const map: Record<string, string[]> = { read: [PERMISSIONS.FRAUD_READ], signal: [PERMISSIONS.FRAUD_SIGNAL], assign: [PERMISSIONS.FRAUD_ASSIGN], decide: [PERMISSIONS.FRAUD_DECIDE], all: Object.values(PERMISSIONS) };
  c.set('user', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', permissions: map[auth.replace('Bearer ', '')] ?? [] }); await next();
} }));
import app from '../../apps/api/src/interfaces/http/app';

const json = { 'Content-Type': 'application/json' };
describe('Fraud Triage protected operating surface', () => {
  beforeEach(() => { vi.clearAllMocks(); operations.overview.mockResolvedValue({ byStatus: {}, byPriority: {}, unassigned: 0 }); operations.list.mockResolvedValue([]); operations.assign.mockResolvedValue({}); operations.decide.mockResolvedValue({}); });
  it('requires authentication and exact read permission', async () => {
    expect((await app.request('/admin/fraud/overview')).status).toBe(401);
    expect((await app.request('/admin/fraud/overview', { headers: { Authorization: 'Bearer forbidden' } })).status).toBe(403);
    expect((await app.request('/admin/fraud/overview', { headers: { Authorization: 'Bearer read' } })).status).toBe(200);
  });
  it('separates signal, assignment and decision privileges', async () => {
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const assign = JSON.stringify({ expectedVersion: 1, assigneeId: id, reason: 'Assigned for review' });
    const decision = JSON.stringify({ expectedVersion: 1, decision: 'HOLD', reason: 'Evidence requires hold', evidence: { review: 'case-1' } });
    expect((await app.request(`/admin/fraud/cases/${id}/assign`, { method: 'POST', headers: { Authorization: 'Bearer read', ...json }, body: assign })).status).toBe(403);
    expect((await app.request(`/admin/fraud/cases/${id}/assign`, { method: 'POST', headers: { Authorization: 'Bearer assign', ...json }, body: assign })).status).toBe(200);
    expect((await app.request(`/admin/fraud/cases/${id}/decision`, { method: 'POST', headers: { Authorization: 'Bearer assign', ...json }, body: decision })).status).toBe(403);
    expect((await app.request(`/admin/fraud/cases/${id}/decision`, { method: 'POST', headers: { Authorization: 'Bearer decide', ...json }, body: decision })).status).toBe(200);
  });
  it('rejects unsafe signal evidence before persistence', async () => {
    const body = JSON.stringify({ referenceKey: 'order:one', signalKey: 'signal:one', sourceType: 'ORDER', sourceRef: 'order:one', subjectRefHash: 'raw-email', signalType: 'VELOCITY', severity: 'HIGH', reasonCode: 'VELOCITY', evidence: {} });
    expect((await app.request('/admin/fraud/signals', { method: 'POST', headers: { Authorization: 'Bearer signal', ...json }, body })).status).toBe(400);
    expect(operations.recordSignal).not.toHaveBeenCalled();
  });
  it('renders truthful review and failure states without public or provider controls', () => {
    const root = path.resolve(__dirname, '../../apps/web/src/pages/admin/fraud');
    const source = fs.readFileSync(path.join(root, 'index.astro'), 'utf8') + fs.readFileSync(path.join(root, '[id].astro'), 'utf8');
    for (const state of ['OPEN','IN_REVIEW','RESOLVED','ALLOW','REVIEW','HOLD','DECLINE','Permission denied','Stale conflict','Empty','Unavailable']) expect(source).toContain(state);
    expect(source).toContain('Automatic decline and checkout mutation are disabled');
    expect(source).toContain('DECLINE is never automatic');
    expect(source).not.toMatch(/provider send|retry provider|apply to checkout/i);
  });
});
