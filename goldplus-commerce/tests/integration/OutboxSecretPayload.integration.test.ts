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
});
