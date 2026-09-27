import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import app from '../../apps/api/src/interfaces/http/app';
import { Registry } from '../../apps/api/src/infrastructure/Registry';
import { toAdminRow } from '../../apps/api/src/infrastructure/db/repositories/DrizzleFakeReportRepository';
import { readFakeReportPage, readVerificationSummary } from '../../apps/web/src/lib/admin-authenticity';
import { buildStopIntakeRequest, endpointRefFor, maskEndpointRef } from '../../apps/web/src/lib/admin-stop-intake';

const seenPerms: string[][] = [];

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    if (!c.req.header('Authorization')?.startsWith('Bearer ')) {
      return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } }, 401);
    }
    c.set('user', { id: 'user-admin', email: 'admin@goldplus.com', permissions: ['*'] });
    await next();
  },
}));

vi.mock('../../apps/api/src/interfaces/http/middleware/permissions', () => ({
  requirePermissions: (perms: string[]) => async (c: any, next: any) => {
    seenPerms.push(perms);
    if (c.req.header('Authorization') === 'Bearer forbidden') {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, 403);
    }
    await next();
  },
}));

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('Authenticity admin reads', () => {
  let listForAdmin: ReturnType<typeof vi.fn>;
  let summarizeAttempts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const registry = Registry.getInstance();
    listForAdmin = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, statusCounts: {}, topLocations: [] });
    summarizeAttempts = vi.fn().mockResolvedValue({ since: 'x', total: 3, genuine: 2, notGenuineOrUnknown: 1, topProducts: [] });
    vi.spyOn(registry, 'fakeReportRepo', 'get').mockReturnValue({ listForAdmin } as any);
    vi.spyOn(registry, 'verificationRepo', 'get').mockReturnValue({ summarizeAttempts } as any);
  });

  it('requires auth and reports.read', async () => {
    expect((await app.request('/governance/admin/fake-reports')).status).toBe(401);
    const forbidden = await app.request('/governance/admin/verification/summary', { headers: { Authorization: 'Bearer forbidden' } });
    expect(forbidden.status).toBe(403);
    expect(seenPerms.some((p) => p.includes('reports.read'))).toBe(true);
  });

  it('lists fake reports paged and validates the status filter', async () => {
    const ok = await app.request('/governance/admin/fake-reports?page=2&status=investigating', { headers: { Authorization: 'Bearer t' } });
    expect(ok.status).toBe(200);
    expect(listForAdmin).toHaveBeenCalledWith({ page: 2, pageSize: 25, status: 'investigating' });
    const bad = await app.request('/governance/admin/fake-reports?status=bogus', { headers: { Authorization: 'Bearer t' } });
    expect(bad.status).toBe(400);
  });

  it('summarises scans over a clamped window', async () => {
    const res = await app.request('/governance/admin/verification/summary?days=9999', { headers: { Authorization: 'Bearer t' } });
    const body = await res.json();
    expect(body.data).toMatchObject({ windowDays: 365, total: 3, genuine: 2, notGenuineOrUnknown: 1 });
  });

  it('answers an honest error, not zeros, when the read fails', async () => {
    listForAdmin.mockRejectedValue(new Error('db down'));
    const res = await app.request('/governance/admin/fake-reports', { headers: { Authorization: 'Bearer t' } });
    expect(res.status).toBe(500);
    const web = await readFakeReportPage(async () => res.clone(), { page: 1, status: null });
    expect(web.ok).toBe(false);
    const offline = await readVerificationSummary(async () => { throw new Error('x'); }, 30);
    expect(offline).toEqual({ ok: false, message: 'The API did not answer.' });
  });

  it('redacts reporter identity in list rows', () => {
    const row = toAdminRow({
      id: 'r1', status: 'new', productDescription: 'Battery', locationFound: 'Kikuubo',
      hologramCode: 'ABC', evidenceUrls: ['a', 'b'], reporterUserId: 'u1', createdAt: new Date('2026-09-01T00:00:00Z'),
    });
    expect(row).toEqual({
      id: 'r1', status: 'new', productDescription: 'Battery', locationFound: 'Kikuubo',
      hologramCodeProvided: true, evidenceCount: 2, reporterSignedIn: true, createdAt: '2026-09-01T00:00:00.000Z',
    });
    expect(JSON.stringify(row)).not.toMatch(/reporterContact|reporterName|u1/);
  });

  it('wires the verification page to the reads and the existing PATCH', () => {
    const page = read('apps/web/src/pages/admin/verification/index.astro');
    expect(page).not.toContain('Not wired');
    expect(page).toContain('readFakeReportPage');
    expect(page).toContain('readVerificationSummary');
    expect(page).toContain('/governance/admin/fake-reports/${encodeURIComponent(id)}/status');
    expect(page).toContain('method: "PATCH"');
  });
});

describe('STOP intake form', () => {
  const form = (values: Record<string, string>) => ({ get: (k: string) => values[k] ?? null });
  const valid = {
    channel: 'whatsapp', contact: '0772 123456', event_type: 'stop', evidence: 'Customer replied STOP in Zoho console',
    provider_event_ref: 'msg-1', provider_occurred_at: '2026-09-27T10:00', authenticity_verified: 'on',
    freshness_verified: 'on', idempotency_key: 'idem-1',
  };

  it('normalises endpoints and masks them for lists', () => {
    expect(endpointRefFor('whatsapp', '0772 123456')).toBe('phone:+256772123456');
    expect(endpointRefFor('email', 'Name@Example.com')).toBe('email:name@example.com');
    expect(endpointRefFor('email', 'nope')).toBeNull();
    expect(maskEndpointRef('phone:+256772123456')).not.toContain('772123');
    expect(maskEndpointRef('email:name@example.com')).toBe('email:n•••@example.com');
  });

  it('builds the body and headers the endpoint requires', () => {
    const built = buildStopIntakeRequest(form(valid), 'corr-1');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.headers).toMatchObject({ 'Idempotency-Key': 'idem-1', 'X-Correlation-Id': 'corr-1' });
    expect(built.request.body).toMatchObject({
      endpoint_ref: 'phone:+256772123456', channel_key: 'whatsapp', event_type: 'stop', provider_key: 'zoho_cpaas',
      provider_event_ref: 'msg-1', provider_callback_ref: 'operator-intake:idem-1',
      authenticity_verified: true, freshness_verified: true,
    });
  });

  it('refuses without explicit operator attestation', () => {
    const built = buildStopIntakeRequest(form({ ...valid, authenticity_verified: '', freshness_verified: '' }), 'c');
    expect(built.ok).toBe(false);
  });

  it('page posts through the existing endpoint and shows the gate', () => {
    const page = read('apps/web/src/pages/admin/consent-operating.astro');
    expect(page).toContain('/admin/consent-operating/provider-suppressions');
    expect(page).toContain('/admin/consent-operating/suppressions');
    expect(page).toContain('CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED');
    expect(page).toContain('provider_suppression_intake_enabled');
    expect(page).toContain('maskEndpointRef');
  });
});
