import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The ambassadors admin route: what each outcome looks like on the wire, and the
 * consent audit row. The service and audit are stubbed; the route's own
 * decisions (status codes, what is recorded, never failing a live save over an
 * audit hiccup) are what is pinned here.
 */
const { service, audit, mediaUseCase } = vi.hoisted(() => ({
  service: { updateAmbassadors: vi.fn(), getAmbassadorsAdmin: vi.fn() },
  audit: { execute: vi.fn() },
  mediaUseCase: { archive: vi.fn() },
}));

vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: { getInstance: () => ({ homepageContentService: service, createAuditLogUseCase: audit, mediaLibraryUseCase: mediaUseCase }) },
}));
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('user', { id: '00000000-0000-4000-8000-000000000050', permissions: ['settings.manage', 'media.manage'] }); await next(); },
}));
vi.mock('../../apps/api/src/interfaces/http/middleware/permissions', () => ({ requirePermissions: () => async (_c: any, next: any) => next() }));
vi.mock('../../apps/api/src/infrastructure/logging/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { default: homepageRoutes } = await import('../../apps/api/src/interfaces/http/routes/admin/homepage');
// The route module is itself a Hono app (mounted at /admin/homepage in production).
const put = (body: unknown) => homepageRoutes.request('/ambassadors', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const changes = { releasesConfirmed: [{ id: 'a', name: 'Esther' }], releasesWithdrawn: [{ id: 'b', name: 'Grace' }], wentLive: [], leftLive: [{ id: 'b', name: 'Grace' }], removed: [] };

beforeEach(() => { vi.clearAllMocks(); });

describe('PUT /admin/homepage/ambassadors', () => {
  it('refuses a body that is not an ambassadors OBJECT (an array included)', async () => {
    expect((await put({ ambassadors: [] })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(service.updateAmbassadors).not.toHaveBeenCalled();
  });

  it('passes the revision through; a conflict is a 409 carrying the current revision', async () => {
    service.updateAmbassadors.mockResolvedValueOnce({ ok: false, conflict: true, currentRevision: 'abc12345' });
    const res = await put({ expectedRevision: 'old', ambassadors: { people: [] } });
    expect(service.updateAmbassadors).toHaveBeenCalledWith({ people: [] }, '00000000-0000-4000-8000-000000000050', 'old');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: 'STALE_REVISION', currentRevision: 'abc12345' });
  });

  it('a missing revision reaches the service as undefined (which saves nothing)', async () => {
    service.updateAmbassadors.mockResolvedValueOnce({ ok: false, conflict: true, currentRevision: 'abc12345' });
    await put({ ambassadors: { people: [] } });
    expect(service.updateAmbassadors.mock.calls[0][2]).toBeUndefined();
  });

  it('field problems are a 422 with every field, section fields at index -1', async () => {
    const fields = [{ index: -1, field: 'ctaHref', message: 'x' }, { index: 0, field: 'name', message: 'y' }];
    service.updateAmbassadors.mockResolvedValueOnce({ ok: false, errors: fields });
    const res = await put({ expectedRevision: 'r', ambassadors: { people: [] } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.fields).toEqual(fields);
  });

  it('audits the change BY NAME with the prior state, and never fails a live save over the audit row', async () => {
    const previous = [{ id: 'b', name: 'Grace', live: true, releaseOnFile: true, releaseConfirmedBy: null, releaseConfirmedAt: null }];
    service.updateAmbassadors.mockResolvedValue({ ok: true, version: 9, changes, previous, usagesPending: false });
    const ok = await put({ expectedRevision: 'r', ambassadors: { people: [] } });
    expect(ok.status).toBe(200);
    expect(audit.execute).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HOMEPAGE_AMBASSADORS_UPDATED',
      previousState: { people: previous },
      newState: { version: 9, ...changes },
    }));
    audit.execute.mockRejectedValueOnce(new Error('audit table locked'));
    const still = await put({ expectedRevision: 'r', ambassadors: { people: [] } });
    expect(still.status).toBe(200);
    expect((await still.json()).data).toEqual({ version: 9 });
  });
});

describe('POST /admin/media/:id/archive', () => {
  it('refuses a photo still used on the site (archiving would not take it down)', async () => {
    const { default: mediaRoutes } = await import('../../apps/api/src/interfaces/http/routes/admin/media');
    mediaUseCase.archive.mockResolvedValueOnce({ kind: 'IN_USE', usages: 2 });
    const res = await mediaRoutes.request('/00000000-0000-4000-8000-000000000001/archive', { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('ASSET_IN_USE');
    expect(audit.execute).not.toHaveBeenCalled();
  });
});
