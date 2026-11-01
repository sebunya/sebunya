import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSISTANT_CONFIG, alarmsCrossed, costMicroUsd, decideAdmission, monthKey, reservationMicroUsd, sanitizeAssistantConfig, type AdmissionSignals,
} from '../../apps/api/src/domain/assistant/AssistantPolicy';

/**
 * The assistant's money and fairness rules (mandate 2026-10-12 §5, §5A). Pure
 * functions, so every tier boundary, ceiling and threshold is pinned here.
 */
const cfg = DEFAULT_ASSISTANT_CONFIG;
const quiet: AdmissionSignals = { meaningfulInWindow: 1, burstInMinute: 1, addressInMinute: 1, paidInHour: 0, paidInDay: 0, paidInPacingWindow: 0, settledMicroUsd: 0, reservedMicroUsd: 0 };

describe('assistant policy: prices and reservations', () => {
  it('prices Haiku 5.5 at the published rates, rounding up to whole micro-dollars', () => {
    // 2,000 input + 200 output = $0.0002 + $0.0001 = 300 micro-USD (the mandate's own planning figure)
    expect(costMicroUsd({ inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'claude-haiku-5-5')).toBe(300);
    expect(costMicroUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 3000, cacheWriteTokens: 0 }, 'claude-haiku-5-5')).toBe(30);
    expect(costMicroUsd({ inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'claude-haiku-5-5')).toBe(1); // ceil(0.1)
  });

  it('prices an unknown model at the dearest known rate, never cheaper', () => {
    const unknown = costMicroUsd({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'claude-mystery-9');
    const opus = costMicroUsd({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'claude-opus-5-5');
    expect(unknown).toBe(opus);
    expect(unknown).toBeGreaterThan(costMicroUsd({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'claude-haiku-5-5'));
  });

  it('reserves the worst case for a turn: every call at the input and output ceilings, nothing cached', () => {
    // 5 calls × (16,000 × 0.1 + 1,024 × 0.5) = 5 × 2,112 = 10,560 micro-USD ≈ $0.0106
    expect(reservationMicroUsd(cfg)).toBe(10_560);
    expect(reservationMicroUsd({ ...cfg, maxToolRounds: 0 })).toBe(2_112);
  });

  it('keeps the kill threshold at or below the cap and drops alarms above the cap', () => {
    const c = sanitizeAssistantConfig({ monthlyCapMicroUsd: 3_000_000, killThresholdMicroUsd: 9_000_000, alarmThresholdsMicroUsd: [4_000_000, 1_000_000, 2_000_000] });
    expect(c.killThresholdMicroUsd).toBe(3_000_000);
    expect(c.alarmThresholdsMicroUsd).toEqual([1_000_000, 2_000_000]);
    expect(sanitizeAssistantConfig({ model: 'DROP TABLE' }).model).toBe('claude-haiku-5-5');
    expect(sanitizeAssistantConfig(null)).toEqual(cfg);
  });

  it('fires each alarm once, on the settlement that crosses it', () => {
    expect(alarmsCrossed(2_499_000, 2_501_000, cfg.alarmThresholdsMicroUsd)).toEqual([2_500_000]);
    expect(alarmsCrossed(2_501_000, 2_600_000, cfg.alarmThresholdsMicroUsd)).toEqual([]);
    expect(alarmsCrossed(0, 4_300_000, cfg.alarmThresholdsMicroUsd)).toEqual([2_500_000, 3_500_000, 4_250_000]);
  });

  it('keys months in UTC', () => {
    expect(monthKey(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
    expect(monthKey(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
  });
});

describe('assistant policy: admission tiers (§5A)', () => {
  it('requests one to four are the welcome tier and get paid AI with no other condition than budget', () => {
    for (const n of [1, 2, 3, 4]) {
      const r = decideAdmission(cfg, true, { ...quiet, meaningfulInWindow: n, paidInHour: 50, paidInDay: 50, paidInPacingWindow: 9 });
      expect(r).toMatchObject({ decision: 'ALLOW_AI', tier: 'welcome' });
    }
  });

  it('the fifth request is progressive, still allowed while the silent allowances hold', () => {
    expect(decideAdmission(cfg, true, { ...quiet, meaningfulInWindow: 5, paidInHour: 3, paidInDay: 5, paidInPacingWindow: 1 })).toMatchObject({ decision: 'ALLOW_AI', tier: 'progressive' });
    expect(decideAdmission(cfg, true, { ...quiet, meaningfulInWindow: 10, paidInHour: 12, paidInDay: 24, paidInPacingWindow: 2 })).toMatchObject({ decision: 'ALLOW_AI' });
  });

  it('beyond the allowances a progressive visitor gets a soft limit (deterministic help continues), not a block', () => {
    expect(decideAdmission(cfg, true, { ...quiet, meaningfulInWindow: 5, paidInHour: 13 })).toMatchObject({ decision: 'SOFT_LIMIT' });
    expect(decideAdmission(cfg, true, { ...quiet, meaningfulInWindow: 5, paidInDay: 25 })).toMatchObject({ decision: 'SOFT_LIMIT' });
    expect(decideAdmission(cfg, true, { ...quiet, meaningfulInWindow: 5, paidInPacingWindow: 3 })).toMatchObject({ decision: 'SOFT_LIMIT', retryAfterSeconds: 15 });
    // The same visitor asking something deterministic is never limited.
    expect(decideAdmission(cfg, false, { ...quiet, meaningfulInWindow: 50, paidInHour: 99 })).toMatchObject({ decision: 'ALLOW_DETERMINISTIC' });
  });

  it('a burst is refused from request one, before any paid work, and a shared address only trips at a high ceiling', () => {
    expect(decideAdmission(cfg, true, { ...quiet, burstInMinute: 21 })).toMatchObject({ decision: 'DENY_EXPENSIVE', retryAfterSeconds: 60 });
    expect(decideAdmission(cfg, false, { ...quiet, burstInMinute: 21 })).toMatchObject({ decision: 'DENY_EXPENSIVE' });
    // 50 honest shoppers behind one carrier NAT, 2 requests each in a minute: nobody is refused.
    expect(decideAdmission(cfg, true, { ...quiet, addressInMinute: 100 })).toMatchObject({ decision: 'ALLOW_AI' });
    expect(decideAdmission(cfg, true, { ...quiet, addressInMinute: 121 })).toMatchObject({ decision: 'DENY_EXPENSIVE' });
  });

  it('the month ledger is the last word: at the kill threshold paid AI stops while deterministic help continues', () => {
    const nearKill = { ...quiet, settledMicroUsd: 4_495_000, reservedMicroUsd: 0 };
    expect(decideAdmission(cfg, true, nearKill)).toMatchObject({ decision: 'GLOBAL_BUDGET_FALLBACK' });
    expect(decideAdmission(cfg, false, nearKill)).toMatchObject({ decision: 'ALLOW_DETERMINISTIC' });
    // In-flight reservations count: settled 4.40 + reserved 0.10 + this turn > 4.50
    expect(decideAdmission(cfg, true, { ...quiet, settledMicroUsd: 4_400_000, reservedMicroUsd: 100_000 })).toMatchObject({ decision: 'GLOBAL_BUDGET_FALLBACK' });
    expect(decideAdmission(cfg, true, { ...quiet, settledMicroUsd: 4_400_000, reservedMicroUsd: 80_000 })).toMatchObject({ decision: 'ALLOW_AI' });
  });

  it('switches: assistant off refuses everything; paid layer off keeps deterministic help', () => {
    expect(decideAdmission({ ...cfg, enabled: false }, false, quiet)).toMatchObject({ decision: 'DISABLED' });
    expect(decideAdmission({ ...cfg, aiEnabled: false }, true, quiet)).toMatchObject({ decision: 'AI_DISABLED' });
    expect(decideAdmission({ ...cfg, aiEnabled: false }, false, quiet)).toMatchObject({ decision: 'ALLOW_DETERMINISTIC' });
  });
});
