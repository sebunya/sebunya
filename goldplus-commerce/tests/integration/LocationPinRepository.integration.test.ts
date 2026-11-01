import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * 0190: the WhatsApp pin repository against real PostgreSQL. Every query here
 * had only run against fakes until 2026-10-16; a wrong column name would have
 * surfaced as a silent failure the first time a customer sent a pin.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('location pin repository (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const tag = randomUUID().slice(0, 8);
  const slug = `test-pin-area-${tag}`;
  const phone = '+256772123456';
  const wamid = `wamid.${tag}`;
  let userId: string;
  let orderId: string;
  let guestOrderId: string;
  let taskId: string;
  let riderId: string;
  let addressId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const { DrizzleLocationPinRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLocationPinRepository');
    repo = new DrizzleLocationPinRepository();

    [{ id: userId }] = await raw`insert into users (email, password_hash) values (${`pin-${tag}@example.test`}, 'x') returning id`;
    await raw`insert into delivery_corridor (area_slug, district, area, corridor, distance_band, access_mode, serviceable, centroid_lat, centroid_lng, centroid_source, centroid_expected_error_m)
      values (${slug}, 'Kampala', ${`Pin Area ${tag}`}, 'kira_rd', 'B2', 'road', true, 0.346700, 32.618100, 'manual', 587)`;
    await raw`insert into delivery_origin (origin_code, name, role, latitude, longitude, active)
      values (${`TEST-${tag}`}, 'Test hub', 'primary_dispatch_hub', 0.314220, 32.577920, true)`;
    // The customer typed the number as 0772…; the WhatsApp side sees +256772….
    [{ id: orderId }] = await raw`insert into orders (order_number, user_id, customer_name, customer_phone, delivery_area, delivery_address, delivery_location, subtotal_amount, total_amount, status, payment_status)
      values (${`GP-${tag}-1`}, ${userId}, 'Pin Tester', '0772 123 456', 'Ntinda', 'Plot 5', ${raw.json({ areaSlug: slug, district: 'Kampala' })}, 100000, 100000, 'processing', 'paid') returning id`;
    [{ id: guestOrderId }] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${`GP-${tag}-2`}, 'Guest', '256772123456', 'Ntinda', 'Plot 6', 50000, 50000, 'received', 'unpaid') returning id`;
    await raw`insert into delivery_quote_capture (order_id, area_slug, quoted_fee_ugx, accuracy_tier) values (${orderId}, ${slug}, 6500, 'AREA_POINT')`;
    [{ id: addressId }] = await raw`insert into addresses (user_id, label, recipient_name, phone, district, area_details, area_slug, is_default)
      values (${userId}, 'Home', 'Pin Tester', '0772123456', 'Kampala', 'near the school', ${slug}, true) returning id`;
    [{ id: riderId }] = await raw`insert into delivery_riders (name, phone_e164) values (${`Rider ${tag}`}, ${`+25670${tag.replace(/\D/g, '').padEnd(7, '1').slice(0, 7)}`}) returning id`;
    [{ id: taskId }] = await raw`insert into fulfilment_tasks (order_id, order_number, status, payment_status, customer_name, customer_contact_masked, delivery_area, delivery_summary, total_ugx, item_count, items, sla_due_at)
      values (${orderId}, ${`GP-${tag}-1`}, 'OUT_FOR_DELIVERY', 'paid', 'Pin Tester', '077****456', 'Ntinda', 'x', 100000, 1, '[]'::jsonb, now()) returning id`;
    await raw`insert into fulfilment_dispatches (fulfilment_task_id, order_id, dispatch_reference, method, payment_policy, dispatch_time, rider_id)
      values (${taskId}, ${orderId}, ${`D-${tag}`}, 'RIDER', 'PREPAID', now(), ${riderId})`;
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from care_tasks where order_number in (${`GP-${tag}-1`}, ${`GP-${tag}-2`})`;
    await raw`delete from whatsapp_pending_location where wamid = ${wamid}`;
    await raw`delete from delivery_order_pin where order_id in (${orderId}, ${guestOrderId})`;
    await raw`delete from fulfilment_dispatches where fulfilment_task_id = ${taskId}`;
    await raw`delete from fulfilment_tasks where id = ${taskId}`;
    await raw`delete from delivery_riders where id = ${riderId}`;
    await raw`delete from delivery_quote_capture where order_id = ${orderId}`;
    await raw`delete from addresses where id = ${addressId}`;
    await raw`delete from orders where id in (${orderId}, ${guestOrderId})`;
    await raw`delete from delivery_origin where origin_code = ${`TEST-${tag}`}`;
    await raw`delete from delivery_corridor where area_slug = ${slug}`;
    await raw`delete from users where id = ${userId}`;
    await raw.end({ timeout: 5 });
  });

  it('finds the open orders for a phone however the number was typed', async () => {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const open = await repo.openOrdersForPhone(phone, since);
    expect(open.map((o: any) => o.id).sort()).toEqual([orderId, guestOrderId].sort());
    const mine = open.find((o: any) => o.id === orderId);
    expect(mine.areaSlug).toBe(slug);
    expect(mine.customerId).toBe(userId);
    expect(open.find((o: any) => o.id === guestOrderId).customerId).toBeNull();
    expect(await repo.openOrdersForPhone('+256700000000', since)).toEqual([]);
  });

  it('knows the area point and the active origin', async () => {
    expect(await repo.areaPoint(slug)).toEqual({ lat: 0.3467, lng: 32.6181, expectedErrorM: 587 });
    expect(await repo.areaPoint('no-such-area')).toBeNull();
    const origin = await repo.activeOrigin();
    expect(origin && typeof origin.lat).toBe('number');
  });

  it('keeps a pending location and reads it back', async () => {
    const expires = new Date(Date.now() + 86_400_000);
    await repo.savePending({ wamid, phoneE164: phone, lat: 0.3467, lng: 32.6181, forwarded: false, candidateOrderIds: [orderId, guestOrderId], riderId: null, expiresAt: expires });
    const p = await repo.pending(wamid);
    expect(p?.phoneE164).toBe(phone);
    expect(p?.candidateOrderIds.sort()).toEqual([orderId, guestOrderId].sort());
    expect(await repo.pending('wamid.nope')).toBeNull();
  });

  it('attaches a pin (idempotently), marks the capture PIN, and saves to the customer address only when asked', async () => {
    const purge = new Date(Date.now() + 180 * 86_400_000);
    await repo.attachPin({ orderId, lat: 0.3461, lng: 32.6177, source: 'whatsapp', sourceRef: wamid, confirmedAt: new Date(), purgeAfter: purge });
    await repo.attachPin({ orderId, lat: 0.3462, lng: 32.6178, source: 'whatsapp', sourceRef: wamid, confirmedAt: new Date(), purgeAfter: purge });
    const [pin] = await raw`select lat, lng, source, saved_to_address from delivery_order_pin where order_id = ${orderId}`;
    expect(Number(pin.lat)).toBeCloseTo(0.3462, 4);
    expect(pin.saved_to_address).toBe(false);
    await repo.markCapturePinned(orderId, 'whatsapp');
    const [cap] = await raw`select accuracy_tier, had_pin, point_source from delivery_quote_capture where order_id = ${orderId}`;
    expect(cap).toMatchObject({ accuracy_tier: 'PIN', had_pin: true, point_source: 'whatsapp' });
    expect(await repo.savePinToAddress(guestOrderId)).toBe('no_customer');
    expect(await repo.savePinToAddress(orderId)).toBe('saved');
    const [addr] = await raw`select gps_lat, gps_lng, gps_source from addresses where id = ${addressId}`;
    expect(Number(addr.gps_lat)).toBeCloseTo(0.3462, 4);
    expect(addr.gps_source).toBe('whatsapp');
    const [after] = await raw`select saved_to_address from delivery_order_pin where order_id = ${orderId}`;
    expect(after.saved_to_address).toBe(true);
  });

  it('recognises a rider by number and lists the stops out with them', async () => {
    const [r] = await raw`select phone_e164 from delivery_riders where id = ${riderId}`;
    const rider = await repo.riderByPhone(r.phone_e164);
    expect(rider?.id).toBe(riderId);
    expect(await repo.riderByPhone('+256700000000')).toBeNull();
    const stops = await repo.openStopsForRider(riderId);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ taskId, orderId, orderNumber: `GP-${tag}-1`, areaSlug: slug, attemptsSoFar: 0 });
  });

  it('flags a far pin as a care task without any coordinate in it, and reads retention from the registry', async () => {
    await repo.flagDisagreement({ orderId, orderNumber: `GP-${tag}-1`, km: 7.4 });
    const [task] = await raw`select kind, title, detail, channel, opened_by from care_tasks where order_number = ${`GP-${tag}-1`}`;
    expect(task.kind).toBe('follow_up');
    expect(task.title).toContain('7.4 km');
    expect(`${task.title} ${task.detail}`).not.toMatch(/\d\.\d{4,}/);
    expect(await repo.retentionDays()).toBeGreaterThanOrEqual(30);
  });
});
