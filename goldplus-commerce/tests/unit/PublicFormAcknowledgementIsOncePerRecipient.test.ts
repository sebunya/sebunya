import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { acknowledgementIdempotencyKey } from '../../apps/api/src/application/use-cases/notifications/AcknowledgementIdempotency';
import { SendPublicFormAcknowledgementUseCase, ACKNOWLEDGEMENTS_PER_RECIPIENT_PER_DAY } from '../../apps/api/src/application/use-cases/notifications/SendPublicFormAcknowledgementUseCase';
import type { PublicFormAcknowledgementMessage } from '../../apps/api/src/application/ports/IPublicFormAcknowledgement';
import { likePrefix } from '../../apps/api/src/infrastructure/notifications/DrizzleAcknowledgementLedger';

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

  it('is ONE per recipient per hour across every form (rotating forms cannot pump)', () => {
    const now = at('2026-09-24T10:00:00Z');
    expect(acknowledgementIdempotencyKey({ kind: 'dealer_application', phone: '0772123456', entityId: 'x', now }))
      .toBe(acknowledgementIdempotencyKey({ kind: 'fake_product_report', phone: '0772123456', entityId: 'y', now }));
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

  it('every public-form acknowledgement goes through the capped use case', () => {
    const gov = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/governance.ts'), 'utf8');
    expect(gov).not.toMatch(/idempotencyKey: `ack:/);
    expect(gov).not.toMatch(/customerOutboxNotifier\.enqueue/);
    expect(gov.match(/sendPublicFormAcknowledgementUseCase\.execute\(\{/g)?.length).toBe(4);
    const commerce = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'), 'utf8');
    expect(commerce).toMatch(/sendPublicFormAcknowledgementUseCase\.execute\(\{\s*kind: 'support_ticket'/);
  });
});

/** In-memory outbox + ledger that behave like outbox_events (unique key, prefix count). */
function fakeOutbox() {
  const rows: Array<{ key: string; at: Date; msg: PublicFormAcknowledgementMessage }> = [];
  let clock = at('2026-09-24T08:00:00Z');
  const outbox = {
    async enqueue(msg: PublicFormAcknowledgementMessage) {
      if (!rows.some((r) => r.key === msg.idempotencyKey)) rows.push({ key: msg.idempotencyKey, at: clock, msg });
      return 'sent' as const;
    },
  };
  const ledger = {
    async countSince(prefix: string, since: Date) {
      return rows.filter((r) => r.key.startsWith(prefix) && r.at >= since).length;
    },
  };
  return { rows, outbox, ledger, set: (iso: string) => { clock = at(iso); }, now: () => clock };
}

const form = (over: Partial<Parameters<SendPublicFormAcknowledgementUseCase['execute']>[0]> = {}) => ({
  kind: 'quote_request',
  eventType: 'QUOTE_REQUEST_RECEIVED',
  template: 'QUOTE_REQUEST_RECEIVED',
  phone: '0772123456',
  email: null,
  data: { reference: 'q' },
  entityId: 'row',
  relatedEntity: 'quote_request',
  ...over,
});

describe('SendPublicFormAcknowledgementUseCase (per-recipient send cap)', () => {
  it('messages a phone once per hour however many forms are posted', async () => {
    const f = fakeOutbox();
    const uc = new SendPublicFormAcknowledgementUseCase(f.outbox, f.ledger, f.now);
    for (let i = 0; i < 20; i++) await uc.execute(form({ entityId: `r${i}`, kind: i % 2 ? 'dealer_application' : 'support_ticket' }));
    expect(f.rows).toHaveLength(1);
  });

  it('stops at the daily ceiling for SMS, and allows it again after 24 hours', async () => {
    const f = fakeOutbox();
    const uc = new SendPublicFormAcknowledgementUseCase(f.outbox, f.ledger, f.now);
    const outcomes: string[] = [];
    for (let h = 8; h < 14; h++) {
      f.set(`2026-09-24T${String(h).padStart(2, '0')}:10:00Z`);
      outcomes.push(await uc.execute(form({ entityId: `h${h}` })));
    }
    expect(f.rows).toHaveLength(ACKNOWLEDGEMENTS_PER_RECIPIENT_PER_DAY);
    expect(outcomes.slice(ACKNOWLEDGEMENTS_PER_RECIPIENT_PER_DAY).every((o) => o === 'daily_cap_reached')).toBe(true);
    f.set('2026-09-25T10:11:00Z');
    expect(await uc.execute(form({ entityId: 'next-day' }))).toBe('queued');
  });

  it('applies the same cap to email-only forms, keyed on the address', async () => {
    const f = fakeOutbox();
    const uc = new SendPublicFormAcknowledgementUseCase(f.outbox, f.ledger, f.now);
    for (let h = 8; h < 16; h++) {
      f.set(`2026-09-24T${String(h).padStart(2, '0')}:00:00Z`);
      await uc.execute(form({ phone: null, email: h % 2 ? 'Victim@Example.com' : ' victim@example.com', entityId: `e${h}` }));
    }
    expect(f.rows).toHaveLength(ACKNOWLEDGEMENTS_PER_RECIPIENT_PER_DAY);
    expect(f.rows.every((r) => r.key.startsWith('ack:mail:victim@example.com:'))).toBe(true);
    expect(f.rows[0].msg.customerPhone).toBeNull();
  });

  it('keeps recipients apart and sends nothing when there is no contact', async () => {
    const f = fakeOutbox();
    const uc = new SendPublicFormAcknowledgementUseCase(f.outbox, f.ledger, f.now);
    expect(await uc.execute(form({ phone: '0772123456' }))).toBe('queued');
    expect(await uc.execute(form({ phone: '0772123457' }))).toBe('queued');
    expect(await uc.execute(form({ phone: '   ', email: '' }))).toBe('no_contact');
    expect(f.rows).toHaveLength(2);
  });

  it('fails closed when the cap cannot be read', async () => {
    const f = fakeOutbox();
    const uc = new SendPublicFormAcknowledgementUseCase(f.outbox, { countSince: async () => { throw new Error('db down'); } }, f.now);
    await expect(uc.execute(form())).rejects.toThrow('db down');
    expect(f.rows).toHaveLength(0);
  });

  it('escapes LIKE metacharacters in the recipient prefix', () => {
    expect(likePrefix('ack:mail:a_b%c@x.ug:')).toBe('ack:mail:a\\_b\\%c@x.ug:%');
  });
});
