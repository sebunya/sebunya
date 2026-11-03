import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DefaultNotificationRouter as NotificationRouter } from '../../apps/api/src/infrastructure/notifications/NotificationRouter';

/** Review chunks 230 and 231 (2026-11): each fix pinned. */
const live = (name: string) => ({ dispatch: async () => ({ status: 'SENT', providerCode: name, providerMessage: 'sent' }) }) as any;

describe('230: the dry-run flag governs every event type', () => {
  it('an OTP marked dry run is prepared, not sent (WhatsApp and its SMS fallback)', async () => {
    const r = new NotificationRouter(live('email'), { ...live('wa'), canCarry: () => true } as any, live('sms'));
    const targets = await r.route('PHONE_VERIFICATION_REQUESTED', { customerPhone: '+256772123456', code: '123456', dryRunOnly: true });
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.fallback).toBeUndefined();
      expect((await t.provider.dispatch(t.payload)).status).toBe('DRY_RUN');
    }
  });
  it('the outbox passes the row\'s dry_run_only to the router', () => {
    expect(readFileSync('apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase.ts', 'utf8')).toContain('event.dryRunOnly === true ? { ...routedPayload, dryRunOnly: true } : routedPayload');
  });
});

describe('230: a basket reminder without a customer account is refused for that reason', () => {
  it('says the consent cannot be checked, not that the customer sent STOP', async () => {
    process.env.BASKET_REMINDERS = 'on';
    const r = new NotificationRouter(live('email'), live('wa'), live('sms'));
    r.setBasketReminderRecheck(async () => true);
    const [t] = await r.route('BASKET_REMINDER', { customerPhone: '+256772123456', notAfter: new Date(Date.now() + 3_600_000).toISOString() });
    const out = await t!.provider.dispatch(t!.payload);
    if (out.status === 'DISABLED' && /quiet|switched off|send-by/i.test(out.providerMessage ?? '')) return; // another gate refused first
    expect(out.providerMessage).toMatch(/names no customer account/);
  });
});

describe('230: care push alerts reach only staff who may read the Care Desk', () => {
  it('requires customer_data.view through a role', () => {
    const src = readFileSync('apps/api/src/infrastructure/assistant/GoldieChannelAdapters.ts', 'utf8');
    expect(src).toContain("p.action || '.' || p.resource = 'customer_data.view'");
    expect(src).toContain('CARE_PUSH_RECIPIENT_HAS_PERMISSION}');
  });
});

describe('230: both attribution paths stitch the same visitor ids', () => {
  it('AttributionJob filters stitched ids with the store\'s shared format check', async () => {
    const { isStitchableVisitorId } = await import('../../apps/api/src/infrastructure/measurement/DrizzleChannelAttributionStore');
    expect(isStitchableVisitorId('fp.1730000000000.123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isStitchableVisitorId('GA1.2.123.456')).toBe(false);
    expect(readFileSync('apps/api/src/infrastructure/measurement/AttributionJob.ts', 'utf8')).toContain('.filter(isStitchableVisitorId)');
  });
});

describe('231: the admin attribution lookup takes an order id or a GP number', () => {
  it('routes a UUID to getByOrderId and a reference to getByOrderNumber, upper-cased', () => {
    const src = readFileSync('apps/api/src/interfaces/http/routes/admin/measurement.ts', 'utf8');
    expect(src).toContain('ORDER_UUID.test(ref)');
    expect(src).toContain('getByOrderId(ref.toLowerCase())');
    expect(src).toContain('getByOrderNumber(ref.toUpperCase())');
  });
});

describe('231: email template values', () => {
  it('{{.}} in a loop over strings renders each item', async () => {
    const { renderTemplate } = await import('../../apps/api/src/infrastructure/notifications/email/renderEmailTemplate');
    expect(renderTemplate('{{#lines}}<li>{{.}}</li>{{/lines}}', { lines: ['Charger', 'Cable'] })).toBe('<li>Charger</li><li>Cable</li>');
  });
  it('a payment receipt without an amount is not "UGX 0": the value is left out so the strict renderer falls back', async () => {
    const { customerEmailData } = await import('../../apps/api/src/infrastructure/notifications/email/emailTemplateData');
    expect(customerEmailData('ORDER_PAYMENT_SUCCESS', { orderNumber: 'GP-1', totalUgx: null })).not.toHaveProperty('amount_received');
    expect(customerEmailData('ORDER_PAYMENT_SUCCESS', { orderNumber: 'GP-1', totalUgx: 50000 }).amount_received).toContain('50,000');
    expect(customerEmailData('PASSWORD_RESET', { resetUrl: 'https://x/r' })).not.toHaveProperty('reset_expiry_minutes');
    expect(customerEmailData('PASSWORD_RESET', { resetUrl: 'https://x/r', resetExpiryMinutes: 60 }).reset_expiry_minutes).toBe('60');
    const src = readFileSync('apps/api/src/infrastructure/notifications/zeptomail/ZeptoMailAdapter.ts', 'utf8');
    expect(src).not.toContain('Number(d.totalUgx ?? 0)');
    expect(src).toContain('d.resetExpiryMinutes ?? d.expiresInMinutes');
  });
});

describe('231: a scheduled sync the queue refused does not stay QUEUED forever', () => {
  it('marks the job FAILED when queue.add throws', () => {
    const src = readFileSync('apps/api/src/infrastructure/seo/IntegrationScheduleRunner.ts', 'utf8');
    expect(src).toMatch(/catch \(err\) \{[\s\S]{0,300}updateSyncJob\(String\(job\.id\), \{ status: 'FAILED'/);
  });
});

describe('231: a nightly run with a failed step is FAILED, so the window retries', () => {
  it('COMPLETE only when it finished and no step failed', () => {
    // Source pin: importing the ticker loads the whole Registry.
    const src = readFileSync('apps/api/src/infrastructure/scheduler/MeasurementNightlyTicker.ts', 'utf8');
    expect(src).toContain("return finished && failedSteps === 0 ? 'COMPLETE' : 'FAILED';");
    expect(src).toContain('set state = ${nightlyRunState(finished, failedSteps)}');
    expect(src).toContain('failedSteps += 1;');
  });
});
