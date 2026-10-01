import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * The activity page's SQL against real PostgreSQL: the browsing-event queue
 * (both payload encodings production holds), the order-path intents, the
 * landing touches and the identity graph. A made-up platform key and click
 * parameter keep the counts exact whatever else is in the database.
 */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;

suite('advertising activity repository (real PostgreSQL)', () => {
  let raw: any;
  let repo: import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdActivityRepository').DrizzleAdActivityRepository;
  const tag = randomUUID().slice(0, 8);
  const platform = `it_${tag}`;
  const clickParam = `itclk_${tag}`;
  const fp = `fp.1.it-activity-${tag}`;
  const eventIds: string[] = [];
  const queueKeys: string[] = [];
  let today = '';
  let recognisedBefore = 0;

  const queue = async (eventName: string, status: string, o: { lastError?: string | null; asString?: boolean; value?: number; processed?: boolean; attempts?: number } = {}) => {
    const key = `ad:${platform}:${randomUUID()}`;
    queueKeys.push(key);
    const payload = { platform, event: { event_name: eventName, event_id: randomUUID(), user_data: { fp_client_id: fp }, ecommerce: o.value ? { value: o.value, currency: 'UGX' } : undefined } };
    // Production holds both shapes: a jsonb object, and a jsonb string containing the object.
    // raw.json() encodes its argument once: an object becomes a jsonb object, a string a jsonb string.
    const json = raw.json(o.asString ? JSON.stringify(payload) : payload);
    await raw`insert into outbox_events (event_type, payload, idempotency_key, status, is_processed, processed_at, last_error, attempt_count)
      values ('AD_CONVERSION', ${json}, ${key}, ${status}, ${!!o.processed}, ${o.processed ? raw`now()` : null}, ${o.lastError ?? null}, ${o.attempts ?? 0})`;
    const [{ t }] = await raw`select jsonb_typeof(payload) as t from outbox_events where idempotency_key = ${key}`;
    expect(t, 'the fixture is the shape it claims to be').toBe(o.asString ? 'string' : 'object');
  };
  const intent = async (state: string, reason: string | null) => {
    const eventId = randomUUID();
    eventIds.push(eventId);
    await raw`insert into measurement.business_event (event_id, environment, business_dedupe_key, aggregate_type, aggregate_id, source_transition_id, event_name, schema_version, occurred_at, payload, canonical_sha256, trace_id)
      values (${eventId}::uuid, 'test', ${`it-activity-${eventId}`}, 'order', ${eventId}, ${eventId}, 'order_confirmed', 1, now(), '{}'::jsonb, ${'a'.repeat(64)}, ${eventId})`;
    await raw`insert into measurement.delivery_intent (delivery_id, event_id, sink_key, environment, state, state_reason, attempt_count, accepted_at)
      values (${randomUUID()}::uuid, ${eventId}::uuid, ${`ad:${platform}:purchase`}, 'test', ${state}, ${reason}, 1, ${state === 'ACCEPTED' ? raw`now()` : null})`;
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL_ as string, { max: 2, onnotice: () => undefined });
    const { DrizzleAdActivityRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdActivityRepository');
    repo = new DrizzleAdActivityRepository();
    today = await repo.today();
    recognisedBefore = await repo.recognised('twclid', today);

    await queue('add_to_cart', 'sent', { processed: true, value: 45000, attempts: 1 });
    await queue('add_to_cart', 'sent', { processed: true, asString: true, value: 12000, attempts: 1 });
    await queue('view_item', 'skipped', { processed: true, lastError: 'no equivalent event or required identifier' });
    await queue('view_item', 'skipped', { processed: true, asString: true, lastError: 'no equivalent event or required identifier' });
    await queue('begin_checkout', 'suppressed', { processed: true, lastError: 'CONSENT_DENIED' });
    await queue('generate_lead', 'dead_letter', { processed: true, lastError: `${platform} HTTP 403: not approved`, attempts: 1 });
    await queue('add_payment_info', 'retrying', { lastError: `${platform} HTTP 503: busy`, attempts: 2 });
    await queue('add_to_cart', 'pending');
    await intent('ACCEPTED', null);
    await intent('SUPPRESSED', 'NO_X_CLICK');
    for (const cls of ['customer', 'customer', 'automated']) {
      await raw`insert into measurement.touchpoint (touch_id, environment, anonymous_id, client_event_id, occurred_at, channel, click_id_types, traffic_class)
        values (${randomUUID()}::uuid, 'test', ${fp}, ${randomUUID()}::uuid, now(), 'paid_social', ${[clickParam]}, ${cls})`;
    }
    // A landing that carried a different click parameter is not this platform's arrival.
    await raw`insert into measurement.touchpoint (touch_id, environment, anonymous_id, client_event_id, occurred_at, channel, click_id_types, traffic_class)
      values (${randomUUID()}::uuid, 'test', ${fp}, ${randomUUID()}::uuid, now(), 'paid_search', ${['gclid']}, 'customer')`;
    await raw`insert into first_party_identities (fp_client_id, twclid) values (${fp}, 'tw-it-activity')`;
  }, 60_000);

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from outbox_events where idempotency_key = any(${queueKeys})`;
    await raw`delete from measurement.delivery_intent where sink_key = ${`ad:${platform}:purchase`}`;
    await raw`delete from measurement.business_event where event_id = any(${eventIds}::uuid[])`;
    await raw`delete from measurement.touchpoint where anonymous_id = ${fp}`;
    await raw`delete from first_party_identities where fp_client_id = ${fp}`;
    await raw.end();
  });

  it('counts browsing events (either payload encoding) and order purchases by event, outcome and stored reason', async () => {
    const counts = await repo.counts(platform, today);
    const of = (event: string, outcome: string) => counts.filter((c) => c.event === event && c.outcome === outcome).reduce((s, c) => s + c.n, 0);
    expect(counts.every((c) => c.day === today)).toBe(true);
    expect(of('add_to_cart', 'sent')).toBe(2);        // one object payload, one string-encoded
    expect(of('add_to_cart', 'waiting')).toBe(1);
    expect(of('view_item', 'not_sent')).toBe(2);
    expect(of('begin_checkout', 'not_sent')).toBe(1);
    expect(of('generate_lead', 'failed')).toBe(1);
    expect(of('add_payment_info', 'waiting')).toBe(1);
    expect(of('purchase', 'sent')).toBe(1);
    expect(of('purchase', 'not_sent')).toBe(1);
    expect(counts.reduce((s, c) => s + c.n, 0)).toBe(10);
    expect(counts.find((c) => c.event === 'view_item')!.reason).toBe('no equivalent event or required identifier');
    expect(counts.find((c) => c.event === 'purchase' && c.outcome === 'not_sent')!.reason).toBe('NO_X_CLICK');
    expect(counts.find((c) => c.event === 'add_to_cart' && c.outcome === 'sent')!.lastAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Another platform's rows are not this platform's.
    expect(await repo.counts(`${platform}_other`, today)).toEqual([]);
    // Nothing before the window is counted, and a future start day returns nothing.
    expect(await repo.counts(platform, '2999-01-01')).toEqual([]);
  });

  it('lists the latest deliveries from both paths, newest first, with value and attempts but no identity', async () => {
    const recent = await repo.recent(platform, today, 50);
    expect(recent).toHaveLength(10);
    expect(recent.map((r) => r.at)).toEqual([...recent.map((r) => r.at)].sort().reverse());
    expect(recent.filter((r) => r.path === 'order').map((r) => r.outcome).sort()).toEqual(['not_sent', 'sent']);
    const sentCart = recent.filter((r) => r.event === 'add_to_cart' && r.outcome === 'sent');
    expect(sentCart.map((r) => r.value).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([12000, 45000]);
    expect(sentCart[0].currency).toBe('UGX');
    expect(recent.find((r) => r.event === 'add_payment_info')).toMatchObject({ outcome: 'waiting', attempts: 2 });
    expect(JSON.stringify(recent)).not.toContain(fp);
    expect(await repo.recent(platform, today, 3)).toHaveLength(3);
  });

  it('counts customer landings that carried the platform\'s click parameter, and recognised visitors', async () => {
    expect(await repo.arrivals(clickParam, today)).toEqual([{ day: today, n: 2 }]);   // the automated one is not an arrival
    expect(await repo.arrivals(`${clickParam}_none`, today)).toEqual([]);
    expect(await repo.recognised('twclid', today)).toBe(recognisedBefore + 1);
    expect(await repo.recognised('twclid', '2999-01-01')).toBe(0);
  });
});
