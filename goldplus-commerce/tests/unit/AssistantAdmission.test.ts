import { describe, expect, it } from 'vitest';
import { AssistantAdmissionUseCases } from '../../apps/api/src/application/use-cases/assistant/AssistantAdmissionUseCases';
import type { IAssistantConfigRepository, IAssistantCounterStore, IAssistantLedgerRepository, MonthTotals } from '../../apps/api/src/application/ports/IAssistantRepository';
import { DEFAULT_ASSISTANT_CONFIG } from '../../apps/api/src/domain/assistant/AssistantPolicy';

/**
 * The admission use case over in-memory counters and ledger: a retried
 * request id is admitted once across replicas, a clarification reply does not
 * spend one of the four welcome requests, and a forged continuation flag on a
 * paid turn buys nothing.
 */
class Counters implements IAssistantCounterStore {
  hits = new Map<string, number>();
  async consume(control: string, identity: string) {
    const k = `${control}:${identity}`; const n = (this.hits.get(k) ?? 0) + 1; this.hits.set(k, n);
    return { count: n, degraded: false };
  }
}
class Ledger implements IAssistantLedgerRepository {
  reserved = 0; settled = 0; ids = 0;
  async reserve(i: { amountMicroUsd: number; killThresholdMicroUsd: number }) { if (this.settled + this.reserved + i.amountMicroUsd > i.killThresholdMicroUsd) return null; this.reserved += i.amountMicroUsd; return { id: `r${++this.ids}`, settledBefore: this.settled }; }
  async settle() { return { settledAfter: this.settled }; }
  async release() { return true; }
  async totals(month: string): Promise<MonthTotals> { return { month, settledMicroUsd: this.settled, reservedMicroUsd: this.reserved, counts: { RESERVED: 0, SETTLED: 0, RELEASED: 0, UNKNOWN: 0 }, outcomes: {} }; }
  async recent() { return []; }
}
const configRepo: IAssistantConfigRepository = { get: async () => ({ config: DEFAULT_ASSISTANT_CONFIG, version: 1 }), save: async () => ({ version: 2 }) };
const make = () => { const c = new Counters(); const l = new Ledger(); return { c, l, uc: new AssistantAdmissionUseCases(l, configRepo, c) }; };
const p = 'a'.repeat(32);

describe('assistant admission use case', () => {
  it('a retried request id is admitted once, even when the retry lands on another replica', async () => {
    const { uc } = make();
    const first = await uc.admit({ principalHash: p, addressHash: null, wantsAi: true, conversationId: null, requestId: 'req-00000001' });
    const retry = await uc.admit({ principalHash: p, addressHash: null, wantsAi: true, conversationId: null, requestId: 'req-00000001' });
    expect(first.decision).toBe('ALLOW_AI');
    expect(retry).toMatchObject({ decision: 'DUPLICATE', reservationId: null });
  });

  it('a clarification reply does not spend a welcome request; a forged flag on a paid turn still counts', async () => {
    const { uc, c } = make();
    for (let i = 0; i < 4; i += 1) await uc.admit({ principalHash: p, addressHash: null, wantsAi: false, conversationId: null });
    expect(c.hits.get(`assistant.meaningful:${p}`)).toBe(4);
    const reply = await uc.admit({ principalHash: p, addressHash: null, wantsAi: false, conversationId: null, continuation: true });
    expect(reply.tier).toBe('welcome'); // still request four, not five
    const forged = await uc.admit({ principalHash: p, addressHash: null, wantsAi: true, conversationId: null, continuation: true });
    expect(forged.tier).toBe('progressive'); // a paid turn is always counted
  });

  it('refuses paid work when the month ledger cannot fit the reservation', async () => {
    const { uc, l } = make();
    l.settled = DEFAULT_ASSISTANT_CONFIG.killThresholdMicroUsd - 1;
    const r = await uc.admit({ principalHash: p, addressHash: null, wantsAi: true, conversationId: null });
    expect(r.decision).toBe('GLOBAL_BUDGET_FALLBACK');
    const free = await uc.admit({ principalHash: p, addressHash: null, wantsAi: false, conversationId: null });
    expect(free.decision).toBe('ALLOW_DETERMINISTIC');
  });
});
