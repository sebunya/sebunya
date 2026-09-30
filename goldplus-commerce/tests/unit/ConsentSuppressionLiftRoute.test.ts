import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /admin/consent-operating/suppressions/:id/lift, through the real route:
 * who may call it, what it refuses, and what it writes to the audit log.
 */
const state = vi.hoisted(() => ({
  gateOn: true,
  lift: vi.fn(),
  audit: vi.fn(),
  requiredPermissions: [] as string[][],
}));

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    if (!c.req.header('Authorization')) return c.json({ success: false, error: 'Unauthorized' }, 401);
    c.set('user', { id: 'admin-7', email: 'ops@goldplus.test', permissions: [] });
    await next();
  },
}));
vi.mock('../../apps/api/src/interfaces/http/middleware/permissions', () => ({
  requirePermissions: (perms: string[]) => async (c: any, next: any) => {
    state.requiredPermissions.push(perms);
    if (c.req.header('Authorization') === 'Bearer read-only') return c.json({ success: false, error: { code: 'FORBIDDEN' } }, 403);
    await next();
  },
}));
vi.mock('../../apps/api/src/infrastructure/consent/ConsentOperatingRuntime', () => ({
  getConsentOperatingRuntime: () => ({
    gates: { CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED: state.gateOn },
    repository: { liftChannelSuppression: state.lift },
  }),
}));
vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: { getInstance: () => ({ createAuditLogUseCase: { execute: state.audit } }) },
}));

import { PERMISSIONS } from '@goldplus/shared';
import routes from '../../apps/api/src/interfaces/http/routes/admin/consent-operating';

const ID = '11111111-2222-4333-8444-555555555555';
const post = (id: string, body: unknown, auth: string | null = 'Bearer admin') =>
  routes.request(`/suppressions/${id}/lift`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('lift a channel suppression', () => {
  beforeEach(() => {
    state.gateOn = true;
    state.requiredPermissions.length = 0;
    state.lift.mockReset().mockResolvedValue({ endpoint_ref: 'phone:+256772123456', channel_key: 'sms', lifted: 2 });
    state.audit.mockReset().mockResolvedValue(undefined);
  });

  it('lifts, reports how many rows ended, and audits the admin and the reason without the contact', async () => {
    const res = await post(ID, { reason: '  recorded against the wrong number ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'lifted', channel_key: 'sms', rows_lifted: 2 });
    expect(state.lift).toHaveBeenCalledWith(ID, { actorId: 'admin-7', reason: 'recorded against the wrong number' });
    expect(state.audit).toHaveBeenCalledTimes(1);
    const audit = state.audit.mock.calls[0][0];
    expect(audit).toMatchObject({
      actorId: 'admin-7', action: 'CONSENT_SUPPRESSION_LIFTED', entity: 'channel_suppression', entityId: ID,
      newState: { channel_key: 'sms', rows_lifted: 2, reason: 'recorded against the wrong number' },
    });
    expect(JSON.stringify(audit)).not.toContain('256772123456');
    expect(JSON.stringify(await (await post(ID, { reason: 'wrong number' })).json())).not.toContain('256772123456');
  });

  it('requires a signed-in admin with the settings right', async () => {
    expect((await post(ID, { reason: 'wrong number' }, null)).status).toBe(401);
    expect((await post(ID, { reason: 'wrong number' }, 'Bearer read-only')).status).toBe(403);
    expect(state.lift).not.toHaveBeenCalled();
    expect(state.requiredPermissions).toContainEqual([PERMISSIONS.SETTINGS_MANAGE]);
  });

  it('refuses a missing or short reason, a malformed id and a non-JSON body before touching anything', async () => {
    expect((await post(ID, {})).status).toBe(400);
    expect((await post(ID, { reason: 'no' })).status).toBe(400);
    expect((await post(ID, { reason: 'x'.repeat(501) })).status).toBe(400);
    expect((await post('not-a-uuid', { reason: 'wrong number' })).status).toBe(400);
    expect((await post(ID, 'not json')).status).toBe(400);
    expect(state.lift).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('an unknown or already lifted suppression is a 404 and writes no audit row', async () => {
    state.lift.mockResolvedValue(null);
    const res = await post(ID, { reason: 'wrong number' });
    expect(res.status).toBe(404);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('is refused while the intake gate is off', async () => {
    state.gateOn = false;
    const res = await post(ID, { reason: 'wrong number' });
    expect(res.status).toBe(503);
    expect(state.lift).not.toHaveBeenCalled();
  });

  it('a failed audit-log write does not misreport a lift whose evidence is already on the row', async () => {
    state.audit.mockRejectedValue(new Error('audit store down'));
    const res = await post(ID, { reason: 'wrong number' });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('lifted');
  });
});
