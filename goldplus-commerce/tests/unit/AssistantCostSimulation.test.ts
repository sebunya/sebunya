import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSISTANT_CONFIG } from '../../apps/api/src/domain/assistant/AssistantPolicy';
import { botnet, flood, fourAndReset, genuineMonth, runAll, simulate } from '../../scripts/qa/assistant-cost-simulation';

/**
 * The month simulation's guarantees (mandate §5.10, §5A.H), pinned: the kill
 * threshold holds under every attack, genuine first-four requests meet no
 * friction while the budget has room, a low-risk fifth request is served,
 * and a normal month fits inside the cap with margin.
 */
const kill = DEFAULT_ASSISTANT_CONFIG.killThresholdMicroUsd / 1e6;

describe('assistant cost simulation', () => {
  const results = runAll();

  it('a normal month of 1,000 sessions costs well under the cap', () => {
    const normal = results[0]!;
    expect(normal.sessions).toBeGreaterThan(800);
    expect(normal.settledUsd).toBeLessThan(1.5);
    expect(normal.killReached).toBe(false);
    expect(normal.welcomeFriction).toBe(0);
    expect(normal.fifthServed).toBe(normal.fifthRequests);
  });

  it('the $7.20 stress month stops paid answers at the kill threshold and keeps answering deterministically', () => {
    const stress = results[1]!;
    expect(stress.peakCommittedUsd).toBeLessThanOrEqual(kill);
    expect(stress.settledUsd).toBeLessThanOrEqual(kill);
    expect(stress.deterministicAnswers + stress.paidCalls).toBe(stress.meaningfulRequests);
  });

  it('no scenario ever commits more than the kill threshold, attacks included', () => {
    for (const r of results) {
      expect(r.peakCommittedUsd, r.name).toBeLessThanOrEqual(kill);
      expect(r.settledUsd, r.name).toBeLessThanOrEqual(kill);
    }
  });

  it('a flooding visitor is refused from its first burst and buys almost nothing', () => {
    const r = simulate('flood only', flood(600));
    expect(r.decisions.DENY_EXPENSIVE).toBeGreaterThan(500);
    // 20 requests pass the burst ceiling; of those only the welcome four plus the pacing allowance are paid.
    expect(r.paidCalls).toBeLessThanOrEqual(8);
  });

  it('four-and-reset is NOT detected by the counters when paced (documented residual risk); the month ledger is the containment', () => {
    const r = simulate('reset only', fourAndReset(11, 300));
    expect(r.attackerPaidCalls).toBe(1200); // four welcome-tier answers per fresh identity, exactly as the policy promises
    expect(r.decisions.DENY_EXPENSIVE).toBe(0); // 13 requests/min per address stays under the 120/min address ceiling
    const past = results[6]!;
    expect(past.killReached).toBe(true);
    expect(past.peakCommittedUsd).toBeLessThanOrEqual(kill);
    expect(past.decisions.GLOBAL_BUDGET_FALLBACK).toBeGreaterThan(0);
    // Genuine shoppers who arrived before the cap was reached met no friction; after it, the deterministic answer still served them.
    expect(past.deterministicAnswers + past.paidCalls).toBe(past.meaningfulRequests);
  });

  it('a botnet behind fifty shared addresses never trips a CGNAT-wide block on its own; the ledger is the containment', () => {
    const r = simulate('botnet only', botnet(13, 500));
    expect(r.decisions.DENY_EXPENSIVE).toBe(0);
    expect(r.peakCommittedUsd).toBeLessThanOrEqual(kill);
  });

  it('fifty honest shoppers behind one carrier address are all served', () => {
    const requests = Array.from({ length: 50 }, (_, k) => Array.from({ length: 2 }, (__, i) => ({ at: i * 20_000 + k * 500, visitor: { principal: `nat${k}`, address: 'carrier-nat', genuine: true }, wantsAi: true, usage: { inputTokens: 500, outputTokens: 200, cacheReadTokens: 1500, cacheWriteTokens: 0 } }))).flat();
    const r = simulate('cgnat', requests);
    expect(r.decisions.DENY_EXPENSIVE).toBe(0);
    expect(r.paidCalls).toBe(100);
  });

  it('is deterministic', () => {
    expect(genuineMonth(7, 2000, 200).length).toBe(genuineMonth(7, 2000, 200).length);
    expect(runAll()[0]!.settledUsd).toBe(results[0]!.settledUsd);
  });
});
