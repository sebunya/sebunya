import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Gap analysis #17 on real PostgreSQL: gift cards and store credit as a tender. Every money rule is proved
 * against the real schema (0196), including two orders racing for one balance.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('store credit and gift cards (real PostgreSQL)', () => {
  let raw: any; let repo: any; let hold: any; let db: any;
  const tag = Date.now().toString(36).toUpperCase();
  const staffA = '00000000-0000-4000-8000-0000000000a1';
  const staffB = '00000000-0000-4000-8000-0000000000b2';
  const orderIds: string[] = [];
  const userIds: string[] = [];
  const instrumentIds: string[] = [];
  let n = 0;

  const order = async (total: number) => {
    n += 1;
    const [r] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, status, payment_status, payment_method, subtotal_amount, delivery_fee, total_amount)
      values (${`GP-SC${tag}${n}`}, 'C', '+256700000001', 'Kampala', 'Plot', 'received', 'unpaid', 'pesapal', ${total}, 0, ${total}) returning id`;
    orderIds.push(r.id);
    return r.id as string;
  };
  const issue = async (value: number, status: 'active' | 'pending_approval' = 'active', issuedBy = staffA) => {
    const { id } = await repo.issue({ kind: 'gift_card', codeHash: `h-${tag}-${Math.random()}`, last4: 'AB12', valueUgx: value, reason: 'Test card', status,
      recipientName: null, recipientPhone: null, customerUserId: null, sourceOrderId: null, issuedBy, expiresAt: null });
    instrumentIds.push(id);
    const [{ code_hash }] = await raw`select code_hash from credit_instruments where id = ${id}`;
    return { id: id as string, hash: code_hash as string };
  };
  const balance = async (id: string) => (await repo.findById(id)).balanceUgx;
  const holdOn = (hash: string, orderId: string, total: number) => db.transaction((tx: any) => hold(tx, { codeHash: hash, orderId, orderTotalUgx: total }));

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    ({ db } = await import('../../apps/api/src/infrastructure/db/client'));
    const mod = await import('../../apps/api/src/infrastructure/credit/DrizzleCreditRepository');
    repo = new mod.DrizzleCreditRepository();
    hold = mod.holdStoreCreditInTx;
  });

  afterAll(async () => {
    if (!raw) return;
    // 0198 makes the ledger append-only; test clean-up uses the deliberate maintenance switch.
    await raw.begin(async (t: any) => {
      await t`set local goldplus.credit_maintenance = 'on'`;
      await t`delete from credit_ledger where instrument_id = any(${instrumentIds})`;
      await t`delete from credit_instruments where id = any(${instrumentIds})`;
    });
    await raw`delete from orders where id = any(${orderIds})`;
    if (userIds.length) await raw`delete from users where id = any(${userIds})`;
    await raw.end();
  });

  it('holds what the balance allows, capped by the order, and records it on the order', async () => {
    const card = await issue(50_000);
    const o = await order(80_000);
    expect(await holdOn(card.hash, o, 80_000)).toBe(50_000);
    expect(await balance(card.id)).toBe(0);
    const [row] = await raw`select store_credit_applied_ugx, store_credit_instrument_id from orders where id = ${o}`;
    expect(Number(row.store_credit_applied_ugx)).toBe(50_000);
    expect(row.store_credit_instrument_id).toBe(card.id);
    // An empty card refuses the next order (and the transaction rolls back).
    await expect(holdOn(card.hash, await order(10_000), 10_000)).rejects.toThrow('STORE_CREDIT_EMPTY');
  });

  it('a paid order captures; a cancelled one releases while held and gives back once after capture', async () => {
    const card = await issue(100_000);
    const unpaid = await order(30_000);
    await holdOn(card.hash, unpaid, 30_000);
    expect(await repo.releaseOrReturnForOrder(unpaid, 'Order cancelled', new Date())).toEqual({ released: 30_000, returned: 0 });
    expect(await balance(card.id)).toBe(100_000);

    const paid = await order(40_000);
    await holdOn(card.hash, paid, 40_000);
    expect((await repo.findById(card.id)).heldUgx).toBe(40_000); // reserved, not spent
    expect(await repo.captureForOrder(paid, new Date())).toBe(40_000);
    expect((await repo.findById(card.id)).heldUgx).toBe(0);
    expect(await repo.captureForOrder(paid, new Date())).toBe(0); // idempotent
    expect(await balance(card.id)).toBe(60_000);
    expect(await repo.releaseOrReturnForOrder(paid, 'Refunded', new Date())).toEqual({ released: 0, returned: 40_000 });
    expect(await repo.releaseOrReturnForOrder(paid, 'Refunded', new Date())).toEqual({ released: 0, returned: 0 });
    expect(await balance(card.id)).toBe(100_000);
  });

  it('two orders racing for one balance never hold more than it', async () => {
    const card = await issue(70_000);
    const [a, b] = [await order(50_000), await order(50_000)];
    const results = await Promise.allSettled([holdOn(card.hash, a, 50_000), holdOn(card.hash, b, 50_000)]);
    const held = results.filter((r) => r.status === 'fulfilled').reduce((s, r: any) => s + r.value, 0);
    expect(held).toBe(70_000);
    expect(await balance(card.id)).toBe(0);
  });

  it('pending, void and expired cards cannot pay; the issuer cannot approve their own', async () => {
    const big = await issue(600_000, 'pending_approval', staffA);
    await expect(holdOn(big.hash, await order(10_000), 10_000)).rejects.toThrow('STORE_CREDIT_UNAVAILABLE');
    expect(await repo.approve(big.id, staffA, new Date())).toBe(false);
    expect(await repo.approve(big.id, staffB, new Date())).toBe(true);
    expect(await holdOn(big.hash, await order(10_000), 10_000)).toBe(10_000);

    const lost = await issue(20_000);
    const inFlight = await order(5_000);
    await holdOn(lost.hash, inFlight, 5_000);
    expect(await repo.voidInstrument(lost.id, staffA, 'Card lost', new Date())).toBe(15_000); // the held 5,000 stays with its order
    await expect(holdOn(lost.hash, await order(1_000), 1_000)).rejects.toThrow('STORE_CREDIT_UNAVAILABLE');

    const old = await issue(20_000);
    await raw`update credit_instruments set expires_at = now() - interval '1 day' where id = ${old.id}`;
    await expect(holdOn(old.hash, await order(1_000), 1_000)).rejects.toThrow('STORE_CREDIT_UNAVAILABLE');
  });

  it('a correction can never take a balance below zero, and an order holds once', async () => {
    const card = await issue(10_000);
    expect(await repo.adjust(card.id, -15_000, staffA, 'Typo at issue')).toBe(false);
    expect(await repo.adjust(card.id, -4_000, staffA, 'Typo at issue')).toBe(true);
    expect(await balance(card.id)).toBe(6_000);
    const o = await order(3_000);
    await holdOn(card.hash, o, 3_000);
    await expect(holdOn(card.hash, o, 3_000)).rejects.toThrow();
    const ledger = await repo.ledger(card.id);
    expect(ledger.map((l: any) => l.type).sort()).toEqual(['ADJUST', 'HOLD', 'ISSUE']);
  });

  const orderNumberOf = async (id: string) => (await raw`select order_number from orders where id = ${id}`)[0].order_number as string;

  it('an item returned gives part back; cancelling later gives back only the rest; nothing goes back twice', async () => {
    const card = await issue(100_000);
    const o = await order(60_000);
    await holdOn(card.hash, o, 60_000);
    await repo.captureForOrder(o, new Date());
    expect(await balance(card.id)).toBe(40_000);
    const ref = await orderNumberOf(o);
    expect(await repo.returnToCardForOrder(ref, 70_000, staffA, 'Too much')).toMatchObject({ ok: false });
    expect(await repo.returnToCardForOrder(ref, 15_000, staffA, 'Charger returned')).toMatchObject({ ok: true, leftUgx: 45_000, refundedSoFarUgx: 15_000 });
    expect(await balance(card.id)).toBe(55_000);
    expect(await repo.releaseOrReturnForOrder(o, 'Order cancelled', new Date())).toEqual({ released: 0, returned: 45_000 });
    expect(await repo.releaseOrReturnForOrder(o, 'Order cancelled', new Date())).toEqual({ released: 0, returned: 0 });
    expect(await repo.returnToCardForOrder(ref, 1, staffA, 'Again?')).toMatchObject({ ok: false });
    expect(await balance(card.id)).toBe(100_000);
  });

  it('a total lowered after the card was applied is not taken from the card', async () => {
    const card = await issue(100_000);
    const o = await order(50_000);
    await holdOn(card.hash, o, 50_000);
    await raw`update orders set total_amount = 42_000 where id = ${o}`; // delivery fee corrected down
    expect(await repo.captureForOrder(o, new Date())).toBe(42_000);
    expect(await balance(card.id)).toBe(58_000);
    expect(Number((await raw`select store_credit_applied_ugx from orders where id = ${o}`)[0].store_credit_applied_ugx)).toBe(42_000);
  });

  it('the database refuses to rewrite or delete card money', async () => {
    const card = await issue(10_000);
    await expect(raw`update credit_ledger set amount_ugx = 999999 where instrument_id = ${card.id}`).rejects.toThrow(/append-only/);
    await expect(raw`delete from credit_ledger where instrument_id = ${card.id}`).rejects.toThrow(/append-only/);
    await expect(raw`update credit_instruments set initial_value_ugx = 999999 where id = ${card.id}`).rejects.toThrow(/fixed at issue/);
    await expect(raw`delete from credit_instruments where id = ${card.id}`).rejects.toThrow(/cancel the card instead/);
    const o = await order(5_000);
    await holdOn(card.hash, o, 5_000);
    await repo.captureForOrder(o, new Date());
    await expect(raw`update credit_ledger set hold_state = 'held' where order_id = ${o}`).rejects.toThrow(/held to captured or released/);
    expect(await balance(card.id)).toBe(5_000);
  });

  it('card money given back on a paid order is a refund to the ad platforms (refund_confirmed, once each)', async () => {
    const card = await issue(100_000);
    const o = await order(60_000);
    await holdOn(card.hash, o, 60_000);
    await repo.captureForOrder(o, new Date());
    const ref = await orderNumberOf(o);
    await repo.returnToCardForOrder(ref, 15_000, staffA, 'Charger returned');
    await repo.releaseOrReturnForOrder(o, 'Order cancelled', new Date());
    await repo.releaseOrReturnForOrder(o, 'Order cancelled', new Date()); // nothing more to give back, nothing more recorded
    const events = await raw`select (payload->>'amountUGX')::int as amount, payload->>'orderNumber' as order_number, payload->>'reason' as reason
                               from measurement.business_event where event_name = 'refund_confirmed' and aggregate_id = ${o} order by occurred_at`;
    expect(events.map((e: any) => e.amount).sort((a: number, b: number) => a - b)).toEqual([15_000, 45_000]);
    expect(events.every((e: any) => e.order_number === ref && /gift card/i.test(e.reason))).toBe(true);
    const routed = await raw`select count(*)::int as n from measurement.event_routing r join measurement.business_event e on e.event_id = r.event_id
                               where e.event_name = 'refund_confirmed' and e.aggregate_id = ${o}`;
    expect(routed[0].n).toBe(2);
    const ledger = await raw`select sum(amount_ugx)::int as s from measurement.commercial_entry where order_ref = ${o} and component = 'REFUND' and source_system = 'credit_ledger'`;
    expect(ledger[0].s).toBe(-60_000);
  });

  it('the accountant export lists every movement of the period, oldest first', async () => {
    const card = await issue(30_000);
    const o = await order(10_000);
    await holdOn(card.hash, o, 10_000);
    await repo.captureForOrder(o, new Date());
    const rows = await repo.ledgerBetween(new Date(Date.now() - 60_000), new Date(Date.now() + 60_000), 50_000);
    const times = rows.map((r: any) => r.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(rows.some((r: any) => r.type === 'ISSUE' && r.amountUgx === 30_000 && r.kind === 'gift_card')).toBe(true);
    expect(rows.some((r: any) => r.type === 'HOLD' && r.holdState === 'captured' && r.amountUgx === -10_000)).toBe(true);
    void card;
  });

  it('a customer sees cards linked to them or texted to their VERIFIED phone, never by an unverified one', async () => {
    const suffix = String(Date.now()).slice(-7);
    const verifiedPhone = `+25677${suffix}`;
    const [v] = await raw`insert into users (email, phone, password_hash, phone_verified_at) values (${`v${tag}@e.com`}, ${verifiedPhone}, 'x', now()) returning id`;
    const [u] = await raw`insert into users (email, phone, password_hash) values (${`u${tag}@e.com`}, ${`+25678${suffix}`}, 'x') returning id`;
    userIds.push(v.id, u.id);
    const byPhone = await repo.issue({ kind: 'gift_card', codeHash: `hp-${tag}`, last4: 'PH01', valueUgx: 20_000, reason: 'Gift', status: 'active',
      recipientName: 'A', recipientPhone: `0${verifiedPhone.slice(4, 7)} ${verifiedPhone.slice(7, 10)}-${verifiedPhone.slice(10)}`, customerUserId: null, sourceOrderId: null, issuedBy: staffA, expiresAt: null });
    const linked = await repo.issue({ kind: 'store_credit', codeHash: `hl-${tag}`, last4: 'LK01', valueUgx: 30_000, reason: 'Refund', status: 'active',
      recipientName: null, recipientPhone: null, customerUserId: u.id, sourceOrderId: null, issuedBy: staffA, expiresAt: null });
    const unverifiedTarget = await repo.issue({ kind: 'gift_card', codeHash: `hu-${tag}`, last4: 'UV01', valueUgx: 10_000, reason: 'Gift', status: 'active',
      recipientName: null, recipientPhone: `+25678${suffix}`, customerUserId: null, sourceOrderId: null, issuedBy: staffA, expiresAt: null });
    instrumentIds.push(byPhone.id, linked.id, unverifiedTarget.id);
    expect((await repo.forCustomer(v.id)).map((c: any) => c.last4)).toEqual(['PH01']);
    expect((await repo.forCustomer(u.id)).map((c: any) => c.last4)).toEqual(['LK01']); // the unverified phone claims nothing
  });

  it('store credit for an order links the order and its account; the card-used lookup and the expiry window work', async () => {
    const [cu] = await raw`insert into users (email, password_hash) values (${`o${tag}@e.com`}, 'x') returning id`;
    userIds.push(cu.id);
    const o = await order(40_000);
    await raw`update orders set user_id = ${cu.id} where id = ${o}`;
    const ref = await orderNumberOf(o);
    expect(await repo.orderForCredit(ref)).toMatchObject({ id: o, userId: cu.id, phone: '+256700000001' });
    expect(await repo.orderForCredit('GP-NOPE')).toBeNull();

    const card = await issue(100_000);
    await raw`update credit_instruments set recipient_phone = '+256772999111' where id = ${card.id}`;
    await holdOn(card.hash, o, 40_000);
    await repo.captureForOrder(o, new Date());
    expect(await repo.cardSpentOnOrder(o)).toMatchObject({ instrumentId: card.id, spentUgx: 40_000, balanceUgx: 60_000, orderNumber: ref, recipientPhone: '+256772999111', orderPhone: '+256700000001' });

    const soon = await issue(5_000);
    await raw`update credit_instruments set recipient_phone = '+256772999222', expires_at = now() + interval '3 days' where id = ${soon.id}`;
    const later = await issue(5_000);
    await raw`update credit_instruments set recipient_phone = '+256772999333', expires_at = now() + interval '30 days' where id = ${later.id}`;
    const due = await repo.expiringSoon(new Date(), new Date(Date.now() + 7 * 86_400_000), 500);
    expect(due.some((d: any) => d.instrumentId === soon.id && d.balanceUgx === 5_000)).toBe(true);
    expect(due.some((d: any) => d.instrumentId === later.id)).toBe(false);
  });
});
