import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

/** Goldie's answer memory (0179) on real PostgreSQL: remember, refresh, pin protection, ratings, route mix. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('answer memory repository (real PostgreSQL)', () => {
  let raw: any;
  let repo: import('../../apps/api/src/infrastructure/assistant/DrizzleAnswerMemoryRepository').DrizzleAnswerMemoryRepository;
  const tag = randomUUID();
  const key = createHash('sha256').update(tag).digest('hex');
  const later = new Date(Date.now() + 86400_000);

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    repo = new (await import('../../apps/api/src/infrastructure/assistant/DrizzleAnswerMemoryRepository')).DrizzleAnswerMemoryRepository();
  });
  afterAll(async () => { await raw`delete from assistant_answer_memory where question_key = ${key}`; await raw.end(); });

  it('remembers, refreshes an unpinned answer, and never overwrites a pinned or edited one', async () => {
    await repo.remember({ key, question: 'best powerbank', answer: 'First answer from the model.', intent: 'PRODUCT', products: [{ slug: 'gp-1', price_ugx: 65000, availability: 'in_stock' }], expiresAt: later });
    await repo.remember({ key, question: 'best powerbank', answer: 'Second answer from the model.', intent: 'PRODUCT', products: [], expiresAt: later });
    let e = (await repo.byKey(key))!;
    expect(e.answer).toBe('Second answer from the model.');
    await repo.update(e.id, { pinned: true, answer: 'The team wrote this one.' });
    await repo.remember({ key, question: 'best powerbank', answer: 'The model tries again.', intent: 'PRODUCT', products: [], expiresAt: later });
    e = (await repo.byKey(key))!;
    expect(e).toMatchObject({ answer: 'The team wrote this one.', pinned: true, edited: true });
  });

  it('counts asks, serves, stale misses and poor ratings', async () => {
    const e = (await repo.byKey(key))!;
    await repo.countAsk(e.id); await repo.served(e.id); await repo.stale(e.id); await repo.poorRating([e.id]);
    const after = (await repo.byKey(key))!;
    expect(after.asks).toBe(e.asks + 1);
    expect(after.served).toBe(e.served + 1);
    expect(after.staleMisses).toBe(e.staleMisses + 1);
    expect(after.poorRatings).toBe(e.poorRatings + 1);
  });

  it('reads the route mix and model spend', async () => {
    const mix = await repo.routeMix(new Date(Date.now() - 7 * 86400_000));
    expect(typeof mix.aiCostMicroUsd).toBe('number');
    expect(mix.byRoute).toBeTypeOf('object');
  });

  it('writes Goldie outbox rows as real JSON objects, so the daily cap can read the recipient', async () => {
    const { insertOutboxObject, DrizzleAssistantMailOutbox } = await import('../../apps/api/src/infrastructure/assistant/AssistantConversationAdapters');
    const recipient = `cap-${tag.slice(0, 8)}@example.com`;
    const id = await insertOutboxObject({ eventType: 'GOLDIE_TRANSCRIPT', template: 'GOLDIE_TRANSCRIPT', channel: 'email', idempotencyKey: `itest-${tag}`, relatedEntity: 'assistant_chat', relatedEntityId: null, payload: { recipient, subject: 's', text: 't', html: 'h' } });
    expect(id).toBeTruthy();
    const [row] = await raw`select jsonb_typeof(payload) as t, payload->>'recipient' as r from outbox_events where id = ${id}`;
    expect(row).toEqual({ t: 'object', r: recipient });
    expect(await new DrizzleAssistantMailOutbox().countTranscriptsSince(recipient, new Date(Date.now() - 60_000))).toBe(1);
    await raw`delete from outbox_events where id = ${id}`;
  });

  it('reads past topics whether the shared capture path double-encoded the payload or not', async () => {
    const { DrizzleAssistantContextReader } = await import('../../apps/api/src/infrastructure/assistant/AssistantConversationAdapters');
    const { HeroSignalsService } = await import('../../apps/api/src/infrastructure/hero/HeroSignalsService');
    const fp = `fp-itest-${tag.slice(0, 8)}`;
    await raw`insert into zero_party_signals (fp_client_id, signal_type, payload, source_component, captured_at) values
      (${fp}, 'declared_intent', to_jsonb(${JSON.stringify({ topic: 'power bank' })}::text), 'goldie_chat', now() - interval '1 minute'),
      (${fp}, 'declared_intent', ${JSON.stringify({ topic: 'usb-c cable' })}::text::jsonb, 'goldie_chat', now())`;
    const ctx = await new DrizzleAssistantContextReader(new HeroSignalsService()).read({ profileId: null, userId: null, fpClientId: fp });
    expect(ctx.pastTopics).toEqual(['usb-c cable', 'power bank']);
    await raw`delete from zero_party_signals where fp_client_id = ${fp}`;
  });
});
