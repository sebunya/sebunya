import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';
const operations = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), detail: vi.fn(), transition: vi.fn(), assignAndExpose: vi.fn() }));
vi.mock('../../apps/api/src/infrastructure/Registry', () => ({ Registry: { getInstance: () => ({ experimentOperationsUseCase: operations }) } }));
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({ authMiddleware: async (c: any, next: any) => { const auth = c.req.header('Authorization'); if (!auth) return c.json({ success: false }, 401); const permissions = auth === 'Bearer all' ? Object.values(PERMISSIONS) : auth === 'Bearer read' ? [PERMISSIONS.EXPERIMENTS_READ] : []; c.set('user', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', permissions }); await next(); } }));
import app from '../../apps/api/src/interfaces/http/app';
describe('Experiments protected API', () => {
  beforeEach(() => { vi.clearAllMocks(); operations.list.mockResolvedValue([]); });
  it('requires authentication and exact read permission', async () => { expect((await app.request('/admin/experiments')).status).toBe(401); expect((await app.request('/admin/experiments', { headers: { Authorization: 'Bearer forbidden' } })).status).toBe(403); expect((await app.request('/admin/experiments', { headers: { Authorization: 'Bearer read' } })).status).toBe(200); });
  it('validates variants before create', async () => { const response = await app.request('/admin/experiments', { method: 'POST', headers: { Authorization: 'Bearer all', 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'test', name: 'Test', hypothesis: 'H', primaryMetric: 'm', variants: [] }) }); expect(response.status).toBe(400); expect(operations.create).not.toHaveBeenCalled(); });
  it('keeps assignment separately privileged', async () => { const response = await app.request('/admin/experiments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/exposures', { method: 'POST', headers: { Authorization: 'Bearer read', 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectKey: 'subject', exposureKey: 'event:one' }) }); expect(response.status).toBe(403); expect(operations.assignAndExpose).not.toHaveBeenCalled(); });
});
