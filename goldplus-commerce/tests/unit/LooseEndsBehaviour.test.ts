import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboundGovernanceService, type OutboundRequest } from '../../apps/api/src/infrastructure/notifications/OutboundGovernanceService';
import { utmLinkDedupeKey } from '../../apps/api/src/application/use-cases/campaigns/CampaignScaffold';
import { ReplayMeasurementDlqUseCase } from '../../apps/api/src/application/use-cases/measurement/ReplayMeasurementDlqUseCase';
import { DismissMeasurementDlqUseCase } from '../../apps/api/src/application/use-cases/measurement/DismissMeasurementDlqUseCase';
import { STOP_CHANNELS, buildLiftRequest, buildStopIntakeRequest } from '../../apps/web/src/lib/admin-stop-intake';
import { parseTierThreshold } from '../../apps/web/src/lib/admin-loyalty-tiers';
import { GET as financeExport } from '../../apps/web/src/pages/api/admin/loyalty/finance-export.csv';

/**
 * Behaviour, not source text. Each case below is a defect that a
 * `readFileSync(...).toContain(...)` test passed straight over.
 */

const LIVE_ENV = {
  PROVIDER_DELIVERY_ENABLED: 'true',
  CUSTOMER_COMMUNICATIONS_ENABLED: 'true',
  NOTIFICATION_DELIVERY_ENABLED: 'true',
  NOTIFICATIONS_LIVE_SEND_ENABLED: 'true',
  NOTIFICATIONS_SMS_ENABLED: 'true',
  NOTIFICATIONS_EMAIL_ENABLED: 'true',
  NOTIFICATIONS_DRY_RUN: 'false',
  NOTIFICATIONS_OPERATOR_APPROVED: 'true',
} as unknown as NodeJS.ProcessEnv;

const marketing = (over: Partial<OutboundRequest> = {}): OutboundRequest => ({
  channel: 'SMS',
  messageClass: 'MARKETING',
  recipientClass: 'CUSTOMER',
  providerConfigured: true,
  allowlistActive: false,
  recipientAllowlisted: false,
  consentGranted: true,
  ...over,
});

describe('a recorded STOP blocks marketing at the shared outbound decision', () => {
  it('without a suppression, consented marketing is allowed', async () => {
    const gov = new OutboundGovernanceService();
    const reader = vi.fn(async () => false);
    gov.setMarketingSuppressionReader(reader);
    const d = await gov.decideForRecipient(marketing(), 'phone:+256772123456', LIVE_ENV);
    expect(d.kind).toBe('ALLOW_LIVE');
    expect(reader).toHaveBeenCalledWith('SMS', 'phone:+256772123456');
  });

  it('a suppressed contact is blocked on SMS and on email, even with consent', async () => {
    const gov = new OutboundGovernanceService();
    gov.setMarketingSuppressionReader(async () => true);
    expect((await gov.decideForRecipient(marketing(), 'phone:+256772123456', LIVE_ENV)).kind).toBe('BLOCK_SUPPRESSION');
    expect((await gov.decideForRecipient(marketing({ channel: 'EMAIL' }), 'email:a@b.com', LIVE_ENV)).kind).toBe('BLOCK_SUPPRESSION');
  });

  it('fails closed: an unreadable suppression state, or no reader at all, blocks marketing', async () => {
    const broken = new OutboundGovernanceService();
    broken.setMarketingSuppressionReader(async () => { throw new Error('db down'); });
    expect((await broken.decideForRecipient(marketing(), 'phone:+256772123456', LIVE_ENV)).kind).toBe('BLOCK_SUPPRESSION');
    const unwired = new OutboundGovernanceService();
    expect((await unwired.decideForRecipient(marketing(), 'phone:+256772123456', LIVE_ENV)).kind).toBe('BLOCK_SUPPRESSION');
  });

  it('a transactional message never reads suppressions and is never blocked by one', async () => {
    const gov = new OutboundGovernanceService();
    const reader = vi.fn(async () => true);
    gov.setMarketingSuppressionReader(reader);
    const d = await gov.decideForRecipient(marketing({ messageClass: 'TRANSACTIONAL', consentGranted: undefined }), 'phone:+256772123456', LIVE_ENV);
    expect(d.kind).toBe('ALLOW_LIVE');
    expect(reader).not.toHaveBeenCalled();
  });

  it('marketing that is already refused keeps its own reason and costs no read', async () => {
    const gov = new OutboundGovernanceService();
    const reader = vi.fn(async () => true);
    gov.setMarketingSuppressionReader(reader);
    const d = await gov.decideForRecipient(marketing({ consentGranted: undefined }), 'phone:+256772123456', LIVE_ENV);
    expect(d.kind).toBe('BLOCK_CONSENT');
    expect(reader).not.toHaveBeenCalled();
  });
});

describe('operator STOP intake', () => {
  const form = (over: Record<string, string> = {}) => {
    const values: Record<string, string> = {
      channel: 'whatsapp', contact: '0772 123456', event_type: 'stop', evidence: 'Customer replied STOP',
      provider_event_ref: 'msg-1', provider_occurred_at: '2026-09-27T14:00', authenticity_verified: 'on',
      freshness_verified: 'on', idempotency_key: 'key-1', ...over,
    };
    return { get: (k: string) => values[k] ?? null };
  };

  it('reads the time the operator typed as Kampala time, whatever the server zone', () => {
    const built = buildStopIntakeRequest(form(), 'corr-1');
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.request.body.provider_occurred_at).toBe('2026-09-27T11:00:00.000Z');
  });

  it('offers every enforced channel and keys each by contact', () => {
    expect([...STOP_CHANNELS]).toEqual(['whatsapp', 'sms', 'email']);
    const sms = buildStopIntakeRequest(form({ channel: 'sms' }), 'c');
    const email = buildStopIntakeRequest(form({ channel: 'email', contact: ' Name@Example.com ' }), 'c');
    expect(sms.ok && sms.request.body.endpoint_ref).toBe('phone:+256772123456');
    expect(email.ok && email.request.body.endpoint_ref).toBe('email:name@example.com');
    expect(email.ok && email.request.body.channel_key).toBe('email');
  });

  it('a lift needs the suppression id and a real reason', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const lift = (o: Record<string, string>) => buildLiftRequest({ get: (k: string) => o[k] ?? null });
    expect(lift({ suppression_id: id, lift_reason: ' wrong number ' })).toEqual({ ok: true, suppressionId: id, reason: 'wrong number' });
    expect(lift({ suppression_id: id, lift_reason: 'no' }).ok).toBe(false);
    expect(lift({ suppression_id: 'not-a-uuid', lift_reason: 'wrong number' }).ok).toBe(false);
  });
});

describe('tier threshold input', () => {
  it('empty is unset, digits are a number, anything else is refused rather than cleared', () => {
    expect(parseTierThreshold('')).toEqual({ ok: true, value: null });
    expect(parseTierThreshold(' 5,000 ')).toEqual({ ok: true, value: 5000 });
    expect(parseTierThreshold('5k').ok).toBe(false);
    expect(parseTierThreshold('-5').ok).toBe(false);
    expect(parseTierThreshold('5.5').ok).toBe(false);
  });
});

describe('UTM link duplicate key', () => {
  const base = { source: 'facebook', medium: 'paid-social', campaignName: 'june' };
  it('the same tags to a different landing page or term are different links', () => {
    const a = utmLinkDedupeKey('c1', { ...base, destinationUrl: 'https://shopgoldplus.com/products/a' });
    const b = utmLinkDedupeKey('c1', { ...base, destinationUrl: 'https://shopgoldplus.com/products/b' });
    expect(a).not.toBe(b);
    expect(utmLinkDedupeKey('c1', { ...base, term: 'x' })).not.toBe(utmLinkDedupeKey('c1', { ...base, term: 'y' }));
  });
  it('an identical link is still a duplicate, and links saved before 0163 keep their key', () => {
    const link = { ...base, content: 'hero', destinationUrl: 'https://shopgoldplus.com/shop' };
    expect(utmLinkDedupeKey('c1', link)).toBe(utmLinkDedupeKey('c1', { ...link }));
    const legacy = `gp-${Math.abs([...'c1facebookpaid-socialjunehero'].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36)}`;
    expect(utmLinkDedupeKey('c1', { ...base, content: 'hero' })).toBe(legacy);
  });
});

describe('failed measurement events: the use cases write no audit of their own', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
  const entry = { id: 'd1', eventId: 'e1', payload: {}, isResolved: false, failedAt: new Date() };

  it('replay enqueues once and resolves the row with nothing else to fail afterwards', async () => {
    const dlq = { findById: vi.fn(async () => entry), markResolved: vi.fn(async () => undefined) };
    const admin = { enqueueTelemetryDispatch: vi.fn(async () => undefined) };
    const out = await new ReplayMeasurementDlqUseCase(dlq as never, admin as never, logger).execute('d1', 'u1');
    expect(admin.enqueueTelemetryDispatch).toHaveBeenCalledTimes(1);
    expect(dlq.markResolved).toHaveBeenCalledWith('d1', 'Manual replay via admin');
    expect(out.message).toMatch(/re-enqueued/);
  });

  it('dismiss resolves the row and returns', async () => {
    const dlq = { findById: vi.fn(async () => entry), markDismissed: vi.fn(async () => true) };
    const out = await new DismissMeasurementDlqUseCase(dlq as never, logger).execute('d1', 'test order', 'u1');
    expect(dlq.markDismissed).toHaveBeenCalledTimes(1);
    expect(out.message).toMatch(/dismissed/);
  });
});

describe('loyalty finance export proxy', () => {
  afterEach(() => vi.unstubAllGlobals());
  const request = new Request('http://localhost/api/admin/loyalty/finance-export.csv', { headers: { cookie: 'goldplus_session=tok' } });

  it('a refusal is returned as the error, not as a downloaded file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: { code: 'FORBIDDEN' } }), { status: 403, headers: { 'Content-Type': 'application/json' } })));
    const res = await financeExport({ request } as never);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ success: false });
  });

  it('a successful export is a CSV attachment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('day,liability\n2026-09-27,1000\n', { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } })));
    const res = await financeExport({ request } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(await res.text()).toContain('2026-09-27,1000');
  });

  it('no session is a 401 and the API is never called', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await financeExport({ request: new Request('http://localhost/x') } as never);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
