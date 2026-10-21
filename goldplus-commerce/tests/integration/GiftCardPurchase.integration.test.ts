import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/**
 * 0199 on real PostgreSQL: a gift card bought online. The card, its ledger row and the text carrying its code are
 * written in ONE transaction, exactly once however many replicas race; the buyer's receipt rides the paid write;
 * the code is scrubbed from the outbox once the message is handled, like every card code (0197).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('gift cards bought online (real PostgreSQL)', () => {
  let raw: any; let repo: any; let outbox: any;
  const tag = Date.now().toString(36).toUpperCase().slice(-6);
  const purchaseIds: string[] = [];
  const instrumentIds: string[] = [];
  let n = 0;
  const ref = () => `GC-${tag}${String(++n).padStart(10 - tag.length, '0')}`.slice(0, 13);

  const create = async (over: Record<string, unknown> = {}) => {
    const p = await repo.create({
      reference: ref(), amountUgx: 50_000, buyerName: 'Robert S', buyerPhone: '+256701333444', buyerEmail: null, buyerUserId: null,
      fromName: 'Rob', recipientName: 'Sarah N', recipientPhone: '+256772111222', sendTo: 'recipient', message: 'Happy birthday!', theme: 'birthday', deliverOn: null, ...over,
    });
    purchaseIds.push(p.id);
    return p;
  };
  const issue = (purchaseId: string, code: string) => repo.issueCard({
    purchaseId, codeHash: `h-${tag}-${code}`, last4: code.slice(-4), reason: 'Bought online test', issuedBy: '00000000-0000-4000-8000-00000000c1f7',
    recipientName: 'Sarah N', recipientPhone: '+256772111222', customerUserId: null, now: new Date(),
    messages: [{ template: 'GIFT_CARD_RECEIVED', phone: '+256772111222', relatedEntity: 'credit_instrument', relatedEntityId: null, idempotencyKey: `gift-card-received:${purchaseId}`,
      data: { template: 'GIFT_CARD_RECEIVED', creditKind: 'gift_card', creditCode: code, valueUgx: 50_000, fromName: 'Rob', giftMessage: 'Happy birthday!' } }],
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    repo = new (await import('../../apps/api/src/infrastructure/credit/DrizzleGiftCardPurchaseRepository')).DrizzleGiftCardPurchaseRepository();
    outbox = new (await import('../../apps/api/src/infrastructure/db/repositories/DrizzleOutboxRepository')).DrizzleOutboxRepository(`worker-${tag}`);
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from outbox_events where idempotency_key like ${'gift-card-%'} and related_entity_id = any(${[...purchaseIds, ...instrumentIds]})`;
    await raw`delete from notification_attempts where related_entity = 'credit_instrument' and related_entity_id = any(${instrumentIds})`;
    await raw`delete from gift_card_purchases where id = any(${purchaseIds})`;
    await raw.begin(async (t: any) => {
      await t`set local goldplus.credit_maintenance = 'on'`;
      await t`delete from credit_ledger where instrument_id = any(${instrumentIds})`;
      await t`delete from credit_instruments where id = any(${instrumentIds})`;
    });
    await raw.end();
  });

  it('paid once, with the buyer’s receipt in the same write; a replay changes nothing', async () => {
    const p = await create();
    await repo.recordStarted(p.id, `T-${p.reference}`, 'https://pay/x');
    await repo.recordStarted(p.id, 'T-OTHER', 'https://pay/y'); // a second start never moves the transaction
    expect((await repo.byTrackingId(`T-${p.reference}`))?.id).toBe(p.id);
    const receipt = { template: 'GIFT_CARD_PAID', phone: '+256701333444', relatedEntity: 'gift_card_purchase', relatedEntityId: p.id, idempotencyKey: `gift-card-paid:${p.id}`,
      data: { template: 'GIFT_CARD_PAID', valueUgx: 50_000, recipientName: 'Sarah', recipientPhoneMasked: '07•• ••• 222', reference: p.reference } };
    expect(await repo.markPaid(p.id, { confirmationCode: 'MTN1', paymentMethod: 'MTN', providerStatus: '1 Completed', now: new Date() }, receipt)).toBe(true);
    expect(await repo.markPaid(p.id, { confirmationCode: 'X', paymentMethod: 'X', providerStatus: 'x', now: new Date() }, receipt)).toBe(false);
    const rows = await raw`select template, related_entity from outbox_events where idempotency_key = ${`gift-card-paid:${p.id}`}`;
    expect(rows).toEqual([{ template: 'GIFT_CARD_PAID', related_entity: 'gift_card_purchase' }]);
    expect((await repo.byReference(p.reference))).toMatchObject({ status: 'paid', confirmationCode: 'MTN1' });
  });

  it('issues one card and one coded text, even when two replicas race', async () => {
    const p = await create();
    await repo.markPaid(p.id, { confirmationCode: 'MTN2', paymentMethod: 'MTN', providerStatus: '1', now: new Date() }, null);
    const [a, b] = await Promise.all([issue(p.id, `GPGC-AAAA-BBBB-${tag.slice(0, 4)}`), issue(p.id, `GPGC-CCCC-DDDD-${tag.slice(0, 4)}`)]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    instrumentIds.push(winners[0].instrumentId);
    const [card] = await raw`select status, initial_value_ugx, issued_by, approved_by, kind from credit_instruments where id = ${winners[0].instrumentId}`;
    expect(card).toMatchObject({ status: 'active', initial_value_ugx: '50000', kind: 'gift_card', issued_by: '00000000-0000-4000-8000-00000000c1f7' });
    const ledger = await raw`select type, amount_ugx from credit_ledger where instrument_id = ${winners[0].instrumentId}`;
    expect(ledger).toEqual([{ type: 'ISSUE', amount_ugx: '50000' }]);
    const texts = await raw`select related_entity, related_entity_id, payload from outbox_events where idempotency_key = ${`gift-card-received:${p.id}`}`;
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ related_entity: 'credit_instrument', related_entity_id: winners[0].instrumentId });
    expect(JSON.stringify(texts[0].payload)).toContain('GPGC-');
    expect((await repo.byReference(p.reference))).toMatchObject({ status: 'issued', instrumentId: winners[0].instrumentId, cardLast4: tag.slice(0, 4) });
    // Not issuable again, and the database refuses an issued purchase without its card.
    expect(await issue(p.id, `GPGC-EEEE-FFFF-${tag.slice(0, 4)}`)).toBeNull();
    await expect(raw`update gift_card_purchases set instrument_id = null where id = ${p.id}`).rejects.toThrow(/gift_card_purchases_issued_chk/);
    // The open page finds the card's face by its code's hash.
    expect(await repo.faceByCodeHash(`h-${tag}-${winners[0] === a ? `GPGC-AAAA-BBBB-${tag.slice(0, 4)}` : `GPGC-CCCC-DDDD-${tag.slice(0, 4)}`}`))
      .toEqual({ theme: 'birthday', fromName: 'Rob', toName: 'Sarah N', message: 'Happy birthday!' });
    expect(await repo.faceByCodeHash('no-such-hash')).toBeNull();
  });

  it('the code leaves the outbox once the text is handled (the 0197 scrub covers gift cards bought online)', async () => {
    const p = await create();
    await repo.markPaid(p.id, { confirmationCode: 'MTN3', paymentMethod: 'MTN', providerStatus: '1', now: new Date() }, null);
    const issued = await issue(p.id, `GPGC-GGGG-HHHH-${tag.slice(0, 4)}`);
    instrumentIds.push(issued.instrumentId);
    const [row] = await raw`select id from outbox_events where idempotency_key = ${`gift-card-received:${p.id}`}`;
    // As the dispatcher does: claim it, send, mark it handled.
    await raw`update outbox_events set worker_id = ${`worker-${tag}`}, status = 'processing', lease_expires_at = now() + interval '5 minutes' where id = ${row.id}`;
    expect(await outbox.markProcessed(row.id)).toBe(true);
    const [after] = await raw`select payload::text as p from outbox_events where id = ${row.id}`;
    expect(after.p).not.toContain('GPGC-GGGG');
    expect(after.p).toContain('creditCodeRemoved');
  });

  it('sends the card to a corrected number: old code void, new card, new text, in one go; a spent card is refused', async () => {
    const p = await create();
    await repo.markPaid(p.id, { confirmationCode: 'MTN6', paymentMethod: 'MTN', providerStatus: '1', now: new Date() }, null);
    const first = await issue(p.id, `GPGC-MMMM-NNNN-${tag.slice(0, 4)}`);
    instrumentIds.push(first.instrumentId);
    expect((await repo.byReference(p.reference)).textStatus).toBe('sending');
    // The provider reports a failure for the first text: staff see it.
    await raw`insert into notification_attempts (channel, recipient, template, status, related_entity, related_entity_id)
              values ('sms', '+256772111222', 'GIFT_CARD_RECEIVED', 'FAILED', 'credit_instrument', ${first.instrumentId})`;
    await raw`update outbox_events set status = 'dead_letter', is_processed = true where related_entity_id = ${first.instrumentId}`;
    expect((await repo.byReference(p.reference)).textStatus).toBe('failed');

    const code = `GPGC-PPPP-QQQQ-${tag.slice(0, 4)}`;
    const msg = (key: string) => ({ template: 'GIFT_CARD_RECEIVED', phone: '+256772999888', relatedEntity: 'credit_instrument', relatedEntityId: null, idempotencyKey: key,
      data: { template: 'GIFT_CARD_RECEIVED', creditKind: 'gift_card', creditCode: code, valueUgx: 50_000, fromName: 'Rob' } });
    const moved = await repo.redirect({ purchaseId: p.id, recipientPhone: '+256772999888', actorId: '00000000-0000-4000-8000-0000000000a1', now: new Date(), note: 'Buyer typo',
      newCard: { codeHash: `h-${tag}-${code}`, last4: code.slice(-4), reason: 'Re-sent', issuedBy: '00000000-0000-4000-8000-00000000c1f7', message: msg(`gift-card-received:${p.id}:r1`) } });
    expect(moved.result).toBe('reissued');
    instrumentIds.push(moved.instrumentId);
    const [oldCard] = await raw`select status, coalesce((select sum(amount_ugx) from credit_ledger where instrument_id = i.id), 0)::int as bal from credit_instruments i where id = ${first.instrumentId}`;
    expect(oldCard).toEqual({ status: 'void', bal: 0 });
    const [newCard] = await raw`select status, recipient_phone, recipient_name, coalesce((select sum(amount_ugx) from credit_ledger where instrument_id = i.id), 0)::int as bal from credit_instruments i where id = ${moved.instrumentId}`;
    expect(newCard).toEqual({ status: 'active', recipient_phone: '+256772999888', recipient_name: 'Sarah N', bal: 50000 });
    const now = await repo.byReference(p.reference);
    expect([now.instrumentId, now.recipientPhone, now.textStatus]).toEqual([moved.instrumentId, '+256772999888', 'sending']);

    // Spent from (an order holds part of it): refused, nothing written.
    await raw`insert into credit_ledger (instrument_id, type, amount_ugx, hold_state, note) values (${moved.instrumentId}, 'HOLD', -10000, 'held', 'test order')`;
    const again = await repo.redirect({ purchaseId: p.id, recipientPhone: '+256772777666', actorId: '00000000-0000-4000-8000-0000000000a1', now: new Date(), note: 'Again',
      newCard: { codeHash: `h-${tag}-again`, last4: 'AGN1', reason: 'Re-sent', issuedBy: '00000000-0000-4000-8000-00000000c1f7', message: msg(`gift-card-received:${p.id}:r2`) } });
    expect(again.result).toBe('touched');
    expect((await raw`select 1 from credit_instruments where code_hash = ${`h-${tag}-again`}`).length).toBe(0);
  });

  it('a scheduled purchase is closed by refund before a card exists; never issued afterwards', async () => {
    const p = await create({ deliverOn: '2030-01-01' });
    await repo.markPaid(p.id, { confirmationCode: 'MTN4', paymentMethod: 'MTN', providerStatus: '1', now: new Date() }, null);
    expect((await repo.paidNotIssued(500)).some((x: any) => x.id === p.id && x.deliverOn === '2030-01-01')).toBe(true);
    expect(await repo.markRefunded(p.id, 'REFUNDING test', { unissuedOnly: true })).toBe(true);
    expect(await issue(p.id, `GPGC-JJJJ-KKKK-${tag.slice(0, 4)}`)).toBeNull();
  });

  it('counts a buyer phone’s purchases and paid total for the daily limit, however the number was typed', async () => {
    const since = new Date(Date.now() - 3_600_000);
    const before = await repo.buyerActivity('0701 333 444', since);
    const p = await create();
    await repo.markPaid(p.id, { confirmationCode: 'MTN5', paymentMethod: 'MTN', providerStatus: '1', now: new Date() }, null);
    const after = await repo.buyerActivity('+256701333444', since);
    expect(after.started).toBe(before.started + 1);
    expect(after.paidUgx).toBe(before.paidUgx + 50_000);
  });

  it('0200: the new occasions are accepted; the occasion settings round-trip (also when stored as a jsonb string)', async () => {
    const p = await create({ theme: 'eid' });
    expect(p.theme).toBe('eid');
    const { DrizzleOccasionSettingsRepository } = await import('../../apps/api/src/infrastructure/credit/DrizzleOccasionSettingsRepository');
    const settings = new DrizzleOccasionSettingsRepository();
    const before = await settings.read();
    await settings.write({ dates: [{ occasion: 'eid', start: '2027-03-10', end: '2027-03-11' }], overrides: [] }, '00000000-0000-4000-8000-0000000000a1');
    expect(await settings.read()).toEqual({ dates: [{ occasion: 'eid', start: '2027-03-10', end: '2027-03-11' }], overrides: [] });
    await raw`update gift_card_occasion_settings set settings = to_jsonb(${JSON.stringify({ overrides: [] })}::text) where id = 1`;
    expect(await settings.read()).toEqual({ overrides: [] });
    await raw`update gift_card_occasion_settings set settings = ${JSON.stringify(before)}::jsonb where id = 1`;
  });

  it('the database refuses an amount outside 10,000–500,000 and a "send to them" with no number', async () => {
    await expect(create({ amountUgx: 600_000 })).rejects.toThrow(/gift_card_purchases_amount_chk/);
    await expect(create({ recipientPhone: null })).rejects.toThrow(/gift_card_purchases_recipient_phone_chk/);
    await expect(create({ theme: 'neon' })).rejects.toThrow(/gift_card_purchases_theme_chk/);
  });
});
