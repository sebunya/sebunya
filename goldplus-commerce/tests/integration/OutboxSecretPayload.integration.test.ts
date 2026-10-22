import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A phone verification code was written in plain text into outbox_events.payload (message and code) and stayed
 * there for good, so anyone with database or queue read access could read live codes. The outbox now strips it
 * when the event is handled (sent or dead-lettered), and never replays such an event. Real PostgreSQL: the scrub
 * is a jsonb expression inside the same UPDATE that finishes the event.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('outbox events that carry a verification code (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const ids: string[] = [];
  const tag = `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const WORKER = `worker-${tag}`;

  const leased = async (eventType: string, payload: Record<string, unknown>) => {
    const [row] = await raw`
      insert into outbox_events (event_type, payload, status, is_processed, idempotency_key, worker_id, lease_expires_at)
      values (${eventType}, ${raw.json(payload)}, 'processing', false, ${`${tag}-${Math.random()}`}, ${WORKER}, now() + interval '5 minutes')
      returning id`;
    ids.push(row.id);
    return row.id as string;
  };
  const payloadOf = async (id: string) => (await raw`select payload from outbox_events where id = ${id}`)[0].payload;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const { DrizzleOutboxRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleOutboxRepository');
    repo = new DrizzleOutboxRepository(WORKER);
  });

  afterAll(async () => {
    if (!raw) return;
    if (ids.length) await raw`delete from outbox_events where id = any(${ids})`;
    await raw.end({ timeout: 5 });
  });

  const otp = { kind: 'phone_verification', message: 'Your GoldPlus verification code is 482913. It expires in 10 minutes.', code: '482913', customerPhone: '+256772000000' };

  it('a retry after a partly sent message keeps the payload an object (a string payload became an array, losing the phone)', async () => {
    const msg = { customerPhone: '+256772000111', customerEmail: 'a@b.test', message: 'Payment received.' };
    // How CustomerOutboxNotifier stores it: a jsonb STRING.
    const [row] = await raw`
      insert into outbox_events (event_type, payload, status, is_processed, idempotency_key, worker_id, lease_expires_at)
      values ('CUSTOMER_ORDER_MESSAGE', ${raw.json(JSON.stringify(msg))}, 'processing', false, ${`${tag}-str`}, ${WORKER}, now() + interval '5 minutes')
      returning id`;
    ids.push(row.id);
    expect(await repo.recordFailure(row.id, 'sms down', new Date(), { sentTargets: ['email'] })).toBe(true);
    const [t] = await raw`select jsonb_typeof(payload) as t from outbox_events where id = ${row.id}`;
    expect(t.t).toBe('object');
    const p = await payloadOf(row.id);
    expect(p.customerPhone).toBe('+256772000111');
    expect(p._sentTargets).toEqual(['email']);
  });

  it('a sent verification event keeps no code', async () => {
    const id = await leased('PHONE_VERIFICATION_REQUESTED', otp);
    expect(await repo.markProcessed(id)).toBe(true);
    const p = await payloadOf(id);
    expect(p.code).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain('482913');
    expect(p.customerPhone).toBe('+256772000000'); // everything else stays for the record
  });

  it('a dead-lettered one keeps no code either, and cannot be replayed', async () => {
    const id = await leased('PHONE_VERIFICATION_REQUESTED', otp);
    expect(await repo.markDeadLettered(id, 'Not retryable: test')).toBe(true);
    expect(JSON.stringify(await payloadOf(id))).not.toContain('482913');
    expect(await repo.replayDeadLettered(id)).toBe(false);
    expect(await repo.requeueForReplay(id, new Date())).toBe(false);
  });

  it('other events are finished, replayed and kept exactly as before', async () => {
    const id = await leased('CUSTOMER_ORDER_MESSAGE', { message: 'Order GP-1 is on its way', code: 'not-a-secret' });
    expect(await repo.markDeadLettered(id, 'Not retryable: test')).toBe(true);
    expect(await payloadOf(id)).toEqual({ message: 'Order GP-1 is on its way', code: 'not-a-secret' });
    expect(await repo.replayDeadLettered(id)).toBe(true);
  });

  // 0196: a gift card / store credit code rides the shared CUSTOMER_ORDER_MESSAGE type, so it is found by its key.
  const card = { template: 'CREDIT_ISSUED', creditCode: 'GPGC-7K2Q-ABCD-EF12', message: 'GoldPlus: you have a gift card of UGX 50,000. Code: GPGC-7K2Q-ABCD-EF12.', customerPhone: '+256772000000' };

  it('a sent gift card message keeps no code, and a failed one cannot be replayed', async () => {
    const sent = await leased('CUSTOMER_ORDER_MESSAGE', card);
    expect(await repo.markProcessed(sent)).toBe(true);
    const p = await payloadOf(sent);
    expect(JSON.stringify(p)).not.toContain('GPGC-7K2Q');
    expect(p.template).toBe('CREDIT_ISSUED');
    expect(p.customerPhone).toBe('+256772000000');

    const failed = await leased('CUSTOMER_ORDER_MESSAGE', card);
    expect(await repo.markDeadLettered(failed, 'Not retryable: test')).toBe(true);
    expect(JSON.stringify(await payloadOf(failed))).not.toContain('GPGC-7K2Q');
    expect(await repo.replayDeadLettered(failed)).toBe(false);
  });

  it('a gift card message written the way the real notifier writes it (a jsonb STRING) is scrubbed too', async () => {
    // drizzle 0.29 + postgres-js store `.values({ payload })` as a JSON string; the first scrub matched only objects,
    // so in production the code would have stayed. This row is written by the real CustomerOutboxNotifier.
    const { CustomerOutboxNotifier } = await import('../../apps/api/src/infrastructure/notifications/CustomerOutboxNotifier');
    const key = `${tag}-notifier`;
    await new CustomerOutboxNotifier().enqueue({
      eventType: 'CUSTOMER_ORDER_MESSAGE', template: 'CREDIT_ISSUED', customerPhone: '+256772000000', customerEmail: null,
      data: { template: 'CREDIT_ISSUED', creditKind: 'gift_card', creditCode: 'GPGC-9Z9Z-ABCD-EF12', valueUgx: 50_000 },
      idempotencyKey: key, relatedEntity: 'credit_instrument', relatedEntityId: null,
    });
    const [row] = await raw`select id, jsonb_typeof(payload) as t from outbox_events where idempotency_key = ${key}`;
    ids.push(row.id);
    expect(row.t).toBe('string'); // the shape production actually has
    expect(JSON.stringify(await payloadOf(row.id))).toContain('GPGC-9Z9Z');
    await raw`update outbox_events set worker_id = ${WORKER}, status = 'processing', lease_expires_at = now() + interval '5 minutes' where id = ${row.id}`;
    expect(await repo.markProcessed(row.id)).toBe(true);
    expect(JSON.stringify(await payloadOf(row.id))).not.toContain('GPGC-9Z9Z');

    const key2 = `${tag}-notifier-2`;
    await new CustomerOutboxNotifier().enqueue({
      eventType: 'CUSTOMER_ORDER_MESSAGE', template: 'CREDIT_ISSUED', customerPhone: '+256772000000', customerEmail: null,
      data: { template: 'CREDIT_ISSUED', creditKind: 'gift_card', creditCode: 'GPGC-8Y8Y-ABCD-EF12', valueUgx: 50_000 },
      idempotencyKey: key2, relatedEntity: 'credit_instrument', relatedEntityId: null,
    });
    const [row2] = await raw`select id from outbox_events where idempotency_key = ${key2}`;
    ids.push(row2.id);
    await raw`update outbox_events set worker_id = ${WORKER}, status = 'processing', lease_expires_at = now() + interval '5 minutes' where id = ${row2.id}`;
    expect(await repo.markDeadLettered(row2.id, 'Not retryable: test')).toBe(true);
    expect(JSON.stringify(await payloadOf(row2.id))).not.toContain('GPGC-8Y8Y');
    expect(await repo.replayDeadLettered(row2.id)).toBe(false);
  });

  it('a plain (non-JSON) string payload is finished untouched rather than breaking the update', async () => {
    const [r] = await raw`insert into outbox_events (event_type, payload, status, is_processed, idempotency_key, worker_id, lease_expires_at)
      values ('CUSTOMER_ORDER_MESSAGE', ${raw.json('just text')}, 'processing', false, ${`${tag}-plain`}, ${WORKER}, now() + interval '5 minutes') returning id`;
    ids.push(r.id);
    expect(await repo.markProcessed(r.id)).toBe(true);
    expect(await payloadOf(r.id)).toBe('just text');
  });

  it('a verification code written by the real OTP sender (a jsonb STRING) can be finished and is scrubbed', async () => {
    // Before payloadObject(), `payload - 'code'` on the string the real sender stores raised "cannot delete from
    // scalar": the event could never be marked sent or dead-lettered, kept its code, and resurfaced every retry.
    const { OutboxOtpSender } = await import('../../apps/api/src/infrastructure/loyalty/LoyaltyIdentityInfrastructure');
    const phone = `+2567${Date.now().toString().slice(-8)}`;
    await new OutboxOtpSender().send(phone, '731904');
    const [row] = await raw`select id, jsonb_typeof(payload) as t from outbox_events where event_type = 'PHONE_VERIFICATION_REQUESTED' and payload::text like ${'%' + phone + '%'}`;
    ids.push(row.id);
    expect(row.t).toBe('string');
    await raw`update outbox_events set worker_id = ${WORKER}, status = 'processing', lease_expires_at = now() + interval '5 minutes' where id = ${row.id}`;
    expect(await repo.markProcessed(row.id)).toBe(true);
    expect(JSON.stringify(await payloadOf(row.id))).not.toContain('731904');
  });
});
