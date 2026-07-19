import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';

const operations = vi.hoisted(() => ({ overview: vi.fn(), list: vi.fn(), detail: vi.fn(), create: vi.fn(), createVersion: vi.fn(), transition: vi.fn(), associateExperiment: vi.fn(), simulate: vi.fn() }));
vi.mock('../../apps/api/src/infrastructure/Registry', () => ({ Registry: { getInstance: () => ({ pricingOperationsUseCase: operations }) } }));
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({ authMiddleware: async (c: any, next: any) => {
  const auth = c.req.header('Authorization'); if (!auth) return c.json({ success: false }, 401);
  const map: Record<string, string[]> = { read: [PERMISSIONS.PRICING_READ], create: [PERMISSIONS.PRICING_CREATE], manage: [PERMISSIONS.PRICING_MANAGE], approve: [PERMISSIONS.PRICING_APPROVE], activate: [PERMISSIONS.PRICING_ACTIVATE], simulate: [PERMISSIONS.PRICING_SIMULATE], pause: [PERMISSIONS.PRICING_PAUSE], all: Object.values(PERMISSIONS) };
  c.set('user', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', permissions: map[auth?.replace('Bearer ', '')] ?? [] }); await next();
} }));
import app from '../../apps/api/src/interfaces/http/app';

const json = { 'Content-Type': 'application/json' };
const transitionBody = JSON.stringify({ versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expectedRevision: 2, reason: 'Commercial governance evidence complete' });

describe('Pricing P5 protected control room', () => {
  beforeEach(() => { vi.clearAllMocks(); operations.overview.mockResolvedValue({ definitionsByStatus: {}, reservationsByStatus: {}, quoteCount: 0, redemptionCount: 0, activeCapacity: [] }); operations.list.mockResolvedValue([]); operations.transition.mockResolvedValue({ definition: { status: 'APPROVED' } }); operations.simulate.mockResolvedValue({ finalTotalUgx: 100_000, decisionTrace: [], adjustments: [] }); });

  it('requires authentication and the exact Pricing read permission', async () => {
    expect((await app.request('/admin/pricing/overview')).status).toBe(401);
    expect((await app.request('/admin/pricing/overview', { headers: { Authorization: 'Bearer forbidden' } })).status).toBe(403);
    expect((await app.request('/admin/pricing/overview', { headers: { Authorization: 'Bearer read' } })).status).toBe(200);
    expect(operations.overview).toHaveBeenCalledOnce();
  });

  it('keeps approval, activation and pause separately privileged', async () => {
    const url = '/admin/pricing/definitions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect((await app.request(`${url}/approve`, { method: 'POST', headers: { Authorization: 'Bearer manage', ...json }, body: transitionBody })).status).toBe(403);
    expect((await app.request(`${url}/activate`, { method: 'POST', headers: { Authorization: 'Bearer approve', ...json }, body: transitionBody })).status).toBe(403);
    expect((await app.request(`${url}/pause`, { method: 'POST', headers: { Authorization: 'Bearer activate', ...json }, body: transitionBody })).status).toBe(403);
    expect(operations.transition).not.toHaveBeenCalled();
  });

  it('maps each privileged transition only for its matching permission', async () => {
    const url = '/admin/pricing/definitions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect((await app.request(`${url}/approve`, { method: 'POST', headers: { Authorization: 'Bearer approve', ...json }, body: transitionBody })).status).toBe(200);
    expect((await app.request(`${url}/activate`, { method: 'POST', headers: { Authorization: 'Bearer activate', ...json }, body: transitionBody })).status).toBe(200);
    expect((await app.request(`${url}/pause`, { method: 'POST', headers: { Authorization: 'Bearer pause', ...json }, body: transitionBody })).status).toBe(200);
    expect(operations.transition.mock.calls.map(([input]) => input.to)).toEqual(['APPROVED', 'ACTIVE', 'PAUSED']);
  });

  it('keeps simulation separately privileged and non-persistent by use-case contract', async () => {
    const body = JSON.stringify({ items: [{ productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quantity: 1 }] });
    expect((await app.request('/admin/pricing/simulate', { method: 'POST', headers: { Authorization: 'Bearer read', ...json }, body })).status).toBe(403);
    expect((await app.request('/admin/pricing/simulate', { method: 'POST', headers: { Authorization: 'Bearer simulate', ...json }, body })).status).toBe(200);
    expect(operations.simulate).toHaveBeenCalledWith(expect.objectContaining({ items: [{ productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quantity: 1 }] }));
  });

  it('renders truthful operating, safety and failure states without sample metrics', () => {
    const root = path.resolve(__dirname, '../../apps/web/src/pages/admin/pricing');
    const source = fs.readFileSync(path.join(root, 'index.astro'), 'utf8') + fs.readFileSync(path.join(root, '[id].astro'), 'utf8');
    for (const state of ['DRAFT','READY_FOR_REVIEW','APPROVED','ACTIVE','PAUSED','EXPIRED','REJECTED','ARCHIVED','RESERVED','REDEEMED','RELEASED','CANCELLED','Permission denied','Stale conflict','Empty','Unavailable']) expect(source).toContain(state);
    for (const guarantee of ['Creates no quote, reservation, redemption, order, payment or provider call','no sample metrics','shared audit']) expect(source.toLowerCase()).toContain(guarantee.toLowerCase());
  });
});
