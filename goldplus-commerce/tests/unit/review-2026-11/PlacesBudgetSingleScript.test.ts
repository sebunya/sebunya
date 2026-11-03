import { describe, it, expect } from 'vitest';
import { RedisPlaceRequestBudget, PLACES_CONSUME_LUA } from '../../../apps/api/src/infrastructure/places/RedisPlaceStores';

describe('Places cap: check and increment are one atomic script', () => {
  it('uses a single EVAL with both counters and no separate read', async () => {
    const calls: any[] = [];
    const fake: any = {
      eval: async (...args: any[]) => { calls.push(args); return [1, 1, 1, 50]; },
      mget: async () => { throw new Error('separate read is not atomic'); },
      multi: () => { throw new Error('separate increment is not atomic'); },
    };
    const b = new RedisPlaceRequestBudget({ suggest: 100, details: 100 }, () => new Date('2026-11-10T12:00:00Z'), () => fake);
    expect(await b.tryConsume('suggest')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(1, 5)).toEqual([2, 'places:suggest:2026-11', 'places:suggest:2026-11-10', '100']);
    expect(PLACES_CONSUME_LUA).toMatch(/if m >= cap or d >= allowance then return \{0/);
  });
  it('a refusal from the script refuses', async () => {
    const fake: any = { eval: async () => [0, 100, 3, 50] };
    const b = new RedisPlaceRequestBudget({ suggest: 100, details: 100 }, () => new Date(), () => fake);
    expect(await b.tryConsume('details')).toBe(false);
  });
});
