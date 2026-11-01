import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Refer a friend, reworked (2026-10-22), on real PostgreSQL with migration 0202:
 * the invite link's opens are counted per person; the friend's referral pays both sides when their first paid order
 * is delivered EVEN when that order earns no points (it used to stay pending for good); a held referral is a state a
 * person releases; the referrer sees each friend by a short name and stage; two first loads get one code.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('refer a friend (real PostgreSQL)', () => {
  let raw: any;
  let R: any;
  const tag = `rr${Date.now().toString(36)}`;
  const users: string[] = [];
  const orders: string[] = [];
  let hadConfig = false;
  const prevGate = process.env.LOYALTY_PROGRAMME_ENABLED;

  const user = async (name: string) => {
    const [u] = await raw`insert into users (email, password_hash) values (${`${name}-${tag}@it.test`}, 'x') returning id`;
    users.push(u.id);
    return u.id as string;
  };
  const order = async (userId: string, customerName: string, phone: string, status = 'processing') => {
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method, user_id, buyer_type)
      values (${`${tag}${orders.length}`.slice(0, 20)}, ${customerName}, ${phone}, 'Kampala', 'Plot 1', 1000, 0, 1000, ${status}, 'paid', 'pesapal', ${userId}, 'retail') returning id`;
    orders.push(o.id);
    return o.id as string;
  };
  const deliver = async (orderId: string) => {
    const ctx = { actorId: null, actorType: 'administrator' as const, source: 'admin_api' as const, reasonCode: 'ADMIN_ACTION', note: 'test' };
    await R.orderTransitionService.transition(orderId, 'dispatched', ctx);
    await R.orderTransitionService.transition(orderId, 'delivered', ctx);
  };
  const points = async (userId: string) =>
    Number((await raw`select coalesce(sum(e.points), 0)::int as p from loyalty_ledger_entries e join loyalty_accounts a on a.id = e.account_id where a.user_id = ${userId} and e.rule_code = 'referral'`)[0].p);

  beforeAll(async () => {
    process.env.LOYALTY_PROGRAMME_ENABLED = 'true';
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    hadConfig = Number((await raw`select count(*)::int as n from loyalty_config`)[0].n) > 0;
    // earn rate 0: every order earns NO points, the case that used to leave a referral pending forever.
    if (!hadConfig) await raw`insert into loyalty_config (enabled, kill_switch, earn_rate_per_1000_ugx, referral_referrer_points, referral_referee_points) values (true, false, 0, 200, 100)`;
    R = (await import('../../apps/api/src/infrastructure/Registry')).Registry.getInstance();
  }, 60_000);

  afterAll(async () => {
    if (prevGate === undefined) delete process.env.LOYALTY_PROGRAMME_ENABLED; else process.env.LOYALTY_PROGRAMME_ENABLED = prevGate;
    if (!raw) return;
    const accounts = (await raw`select id from loyalty_accounts where user_id = any(${users})`).map((a: any) => a.id);
    await raw`delete from loyalty_ledger_entries where account_id = any(${accounts})`.catch(() => undefined);
    await raw`delete from loyalty_referrals where referrer_user_id = any(${users}) or referee_user_id = any(${users})`;
    await raw`delete from loyalty_referral_visits where code like 'RR%' or code in (select referral_code from users where id = any(${users}))`.catch(() => undefined);
    await raw`delete from order_events where order_id = any(${orders})`.catch(() => undefined);
    await raw`delete from orders where id = any(${orders})`.catch(() => undefined);
    if (!hadConfig) await raw`delete from loyalty_config`;
    await raw.end({ timeout: 5 });
  });

  it('two first loads at once get ONE code', async () => {
    const u = await user('race');
    const codes = await Promise.all(Array.from({ length: 5 }, () => R.loyaltyReferralRepo.getOrCreateCode(u)));
    expect(new Set(codes).size).toBe(1);
    expect((await raw`select referral_code from users where id = ${u}`)[0].referral_code).toBe(codes[0]);
  });

  it('counts link opens per person, and ignores a code that is no customer\'s', async () => {
    const u = await user('opens');
    const code = await R.loyaltyReferralRepo.getOrCreateCode(u);
    await R.loyaltyReferralRepo.recordVisit(code, 'visitor-aaaaaaaaaaaaaaaa', 'whatsapp');
    await R.loyaltyReferralRepo.recordVisit(code, 'visitor-aaaaaaaaaaaaaaaa', 'whatsapp');
    await R.loyaltyReferralRepo.recordVisit(code, 'visitor-bbbbbbbbbbbbbbbb', 'sms');
    await R.loyaltyReferralRepo.recordVisit('RRNOBODY', 'visitor-cccccccccccccccc', 'link');
    const rows = await raw`select how, opens from loyalty_referral_visits where code = ${code} order by how`;
    expect(rows.map((r: any) => [r.how, r.opens])).toEqual([['sms', 1], ['whatsapp', 2]]);
    expect((await raw`select count(*)::int as n from loyalty_referral_visits where code = 'RRNOBODY'`)[0].n).toBe(0);
  });

  it('link → friend joins → first delivered order that earns no points → both are paid, once', async () => {
    const referrer = await user('referrer');
    await order(referrer, 'Robert Sebunya', '0772000111', 'delivered');
    const code = await R.loyaltyReferralRepo.getOrCreateCode(referrer);
    expect(await R.loyaltyReferralRepo.inviterFor(code)).toEqual({ name: 'Robert S.' });
    const friend = await user('friend');
    expect(await R.recordReferralUseCase.execute({ refereeUserId: friend, code: code.toLowerCase(), source: 'link' })).toEqual({ ok: true, status: 'recorded' });
    expect((await raw`select source, status from loyalty_referrals where referee_user_id = ${friend}`)[0]).toEqual({ source: 'link', status: 'pending' });

    const first = await order(friend, 'Sarah Nakato', '0701000222');
    let list = await R.loyaltyReferralRepo.listForReferrer(referrer);
    expect(list[0]).toMatchObject({ status: 'pending', friendName: 'Sarah N.', friendHasOrdered: true });

    await deliver(first);
    expect((await raw`select status, qualifying_order_id from loyalty_referrals where referee_user_id = ${friend}`)[0]).toEqual({ status: 'awarded', qualifying_order_id: first });
    expect(await points(referrer)).toBe(200);
    expect(await points(friend)).toBe(100);

    const second = await order(friend, 'Sarah Nakato', '0701000222');
    await deliver(second);
    expect(await points(referrer)).toBe(200);
    list = await R.loyaltyReferralRepo.listForReferrer(referrer);
    expect(list[0]).toMatchObject({ status: 'awarded' });

    const funnel = await R.loyaltyReferralRepo.funnel(30);
    expect(funnel.awarded).toBeGreaterThanOrEqual(1);
    expect(funnel.bySource.link).toBeGreaterThanOrEqual(1);
  });

  it('a code added after the first delivery is refused; a held referral is released by a person and pays', async () => {
    const referrer = await user('ref2');
    const code = await R.loyaltyReferralRepo.getOrCreateCode(referrer);
    const late = await user('late');
    await order(late, 'Late Customer', '0701000333', 'delivered');
    expect(await R.recordReferralUseCase.execute({ refereeUserId: late, code, source: 'account' })).toMatchObject({ ok: false, code: 'ALREADY_A_CUSTOMER' });

    const friend = await user('held');
    await R.recordReferralUseCase.execute({ refereeUserId: friend, code, source: 'typed' });
    const ref = (await raw`select id from loyalty_referrals where referee_user_id = ${friend}`)[0].id;
    const o = await order(friend, 'Held Friend', '0701000444', 'delivered');
    await R.loyaltyReferralRepo.markHeld(ref, 'ORDER_TO_REFERRER_PHONE', o);
    const admin = await user('admin');
    expect(await R.decideHeldReferralUseCase.execute({ referralId: ref, decision: 'release', actorId: admin })).toMatchObject({ ok: true, status: 'awarded' });
    const row = (await raw`select status, decided_by from loyalty_referrals where id = ${ref}`)[0];
    expect(row).toEqual({ status: 'awarded', decided_by: admin });
    expect(await points(referrer)).toBe(200);
    expect((await R.loyaltyReferralRepo.adminList('awarded')).some((r: any) => r.id === ref)).toBe(true);
  });
});
