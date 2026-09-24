import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { acknowledgementIdempotencyKey } from '../../apps/api/src/application/use-cases/notifications/AcknowledgementIdempotency';

/**
 * Public forms (dealer application, quote, support issue, fake report) text an
 * acknowledgement to the phone typed on the form. Each one used a key made from
 * the new row's uuid, so a scripted flood was one paid SMS per post — to any
 * Ugandan number, on the credit that carries OTPs and paid-order alerts. The
 * key is now the recipient and the hour, and the outbox dedupes on it.
 */
const at = (iso: string) => new Date(iso);

describe('acknowledgementIdempotencyKey', () => {
  it('gives two submissions for the same phone in the same hour the SAME key', () => {
    const a = acknowledgementIdempotencyKey({ kind: 'dealer_application', phone: '0772 123 456', entityId: 'row-1', now: at('2026-09-24T10:05:00Z') });
    const b = acknowledgementIdempotencyKey({ kind: 'dealer_application', phone: '+256772123456', entityId: 'row-2', now: at('2026-09-24T10:55:00Z') });
    expect(a).toBe(b);
    expect(a).not.toContain('row-');
  });

  it('allows a fresh acknowledgement the next hour, and for another number', () => {
    const base = { kind: 'dealer_application', entityId: 'row-1' };
    const a = acknowledgementIdempotencyKey({ ...base, phone: '0772123456', now: at('2026-09-24T10:59:00Z') });
    expect(acknowledgementIdempotencyKey({ ...base, phone: '0772123456', now: at('2026-09-24T11:00:00Z') })).not.toBe(a);
    expect(acknowledgementIdempotencyKey({ ...base, phone: '0772123457', now: at('2026-09-24T10:59:00Z') })).not.toBe(a);
  });

  it('keeps forms apart: a dealer application does not swallow a fake-report ack', () => {
    const now = at('2026-09-24T10:00:00Z');
    expect(acknowledgementIdempotencyKey({ kind: 'dealer_application', phone: '0772123456', entityId: 'x', now }))
      .not.toBe(acknowledgementIdempotencyKey({ kind: 'fake_product_report', phone: '0772123456', entityId: 'x', now }));
  });

  it('falls back to the email (case-insensitive), then to the row id when there is no contact', () => {
    const now = at('2026-09-24T10:00:00Z');
    expect(acknowledgementIdempotencyKey({ kind: 'quote_request', email: 'A@B.ug', entityId: 'r1', now }))
      .toBe(acknowledgementIdempotencyKey({ kind: 'quote_request', email: ' a@b.ug ', entityId: 'r2', now }));
    expect(acknowledgementIdempotencyKey({ kind: 'quote_request', entityId: 'r1', now })).toBe('ack:quote_request:r1');
  });

  it('always fits the outbox key column (varchar 255)', () => {
    const key = acknowledgementIdempotencyKey({ kind: 'fake_product_report', email: `${'x'.repeat(400)}@example.com`, entityId: 'r', now: at('2026-09-24T10:00:00Z') });
    expect(key.length).toBeLessThanOrEqual(255);
  });

  it('is the key every public-form acknowledgement in governance.ts uses', () => {
    const src = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/governance.ts'), 'utf8');
    expect(src).not.toMatch(/idempotencyKey: `ack:/);
    expect(src.match(/acknowledgementIdempotencyKey\(\{/g)?.length).toBe(4);
  });
});
