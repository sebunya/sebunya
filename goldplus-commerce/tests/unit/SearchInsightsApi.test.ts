import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';

const calls = vi.hoisted(() => ({ search: vi.fn(), interaction: vi.fn(), insights: vi.fn(), demand: vi.fn() }));
vi.mock('../../apps/api/src/infrastructure/Registry', () => ({ Registry: { getInstance: () => ({
  recordSearchEventUseCase: { execute: calls.search },
  recordSearchInteractionUseCase: { execute: calls.interaction },
  getSearchInsightsUseCase: { execute: calls.insights },
  listSearchDemandUseCase: { execute: calls.demand },
}) } }));
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({ authMiddleware: async (c: any, next: any) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', ''); if (!token) return c.json({ success: false }, 401);
  c.set('user', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', permissions: token === 'reports' ? [PERMISSIONS.REPORTS_READ] : [] }); await next();
} }));
import app from '../../apps/api/src/interfaces/http/app';
const json = { 'Content-Type': 'application/json' };

describe('Search Insights APIs', () => {
  beforeEach(() => { vi.clearAllMocks(); calls.search.mockResolvedValue({ recorded: true }); calls.interaction.mockResolvedValue({ recorded: true }); calls.insights.mockResolvedValue({ totalSearches: 0, ranking: [], synonymCandidates: [] }); calls.demand.mockResolvedValue([]); });
  it('accepts only bounded aggregate interaction facts', async () => {
    const body = JSON.stringify({ query: 'power bank', productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rank: 1, type: 'click', email: 'ignored@invalid.test', sessionId: 'ignored' });
    expect((await app.request('/products/search-interactions', { method: 'POST', headers: json, body })).status).toBe(200);
    expect(calls.interaction).toHaveBeenCalledWith({ query: 'power bank', productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rank: 1, type: 'click' });
    expect(calls.interaction.mock.calls[0][0]).not.toHaveProperty('email');
    expect(calls.interaction.mock.calls[0][0]).not.toHaveProperty('sessionId');
  });
  it('requires authentication and reports.read for insights', async () => {
    expect((await app.request('/admin/search-demand/insights')).status).toBe(401);
    expect((await app.request('/admin/search-demand/insights', { headers: { Authorization: 'Bearer none' } })).status).toBe(403);
    expect((await app.request('/admin/search-demand/insights', { headers: { Authorization: 'Bearer reports' } })).status).toBe(200);
    expect(calls.insights).toHaveBeenCalledOnce();
  });
});
