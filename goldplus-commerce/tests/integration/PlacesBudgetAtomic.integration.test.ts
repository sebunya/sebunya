import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { RedisPlaceRequestBudget } from '../../apps/api/src/infrastructure/places/RedisPlaceStores';

/** Set REDIS_TEST_URL to run: the Places cap is checked and spent in one Lua call, so a burst never overruns it. */
const URL = process.env.REDIS_TEST_URL;
const suite = URL ? describe : describe.skip;

suite('Places monthly cap under parallel requests', () => {
  let raw: Redis;
  beforeAll(() => { raw = new Redis(URL!); });
  afterAll(async () => { await raw.quit(); });

  it('100 parallel requests against 5 left spend exactly 5', async () => {
    const clock = () => new Date('2026-11-30T12:00:00Z'); // last day of the month
    await raw.del('places:suggest:2026-11', 'places:suggest:2026-11-30');
    await raw.set('places:suggest:2026-11', '95');
    const budget = new RedisPlaceRequestBudget({ suggest: 100, details: 100 }, clock, () => raw);
    const results = await Promise.all(Array.from({ length: 100 }, () => budget.tryConsume('suggest')));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(Number(await raw.get('places:suggest:2026-11'))).toBe(100);
  });
});
