import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Fixes from the 2026-11 gift card / store credit / loyalty review that are best proven by their wiring. */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('manual points adjustment', () => {
  it('needs a fresh step-up, like creating store credit', () => {
    const routes = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
    const line = routes.split('\n').find((l) => l.startsWith("routes.post('/adjust'"))!;
    expect(line).toContain("requireStepUp('payment_refund')");
    expect(read('apps/web/src/pages/admin/loyalty/adjustments.astro')).toContain('MFA_STEP_UP_REQUIRED');
  });
});

describe('credit expiry typed by an admin', async () => {
  const { parseCreditExpiry } = await import('../../apps/api/src/domain/credit/CreditInstrument');
  const now = new Date('2026-11-01T10:00:00Z');
  it('refuses a date that cannot be read instead of issuing credit that never expires', () => {
    for (const bad of ['2026-13-40', '31/12/2026', '2027-02-30', 'soon']) {
      expect(parseCreditExpiry(bad, now)).toMatchObject({ ok: false, code: 'BAD_EXPIRY' });
    }
  });
  it('empty is no expiry; a day is valid through that day in Kampala; the past is refused', () => {
    expect(parseCreditExpiry('', now)).toEqual({ ok: true, expiresAt: null });
    expect(parseCreditExpiry(undefined, now)).toEqual({ ok: true, expiresAt: null });
    expect(parseCreditExpiry('2026-12-31', now)).toEqual({ ok: true, expiresAt: new Date('2026-12-31T20:59:59Z') });
    expect(parseCreditExpiry('2026-10-31', now)).toMatchObject({ ok: false, message: 'The expiry date is in the past.' });
  });
});
