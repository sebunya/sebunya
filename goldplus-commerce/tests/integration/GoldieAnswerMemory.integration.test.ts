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
});
