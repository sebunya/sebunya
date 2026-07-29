import { describe, it, expect } from 'vitest';
import { computeBackoffSeconds } from '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase';

/**
 * Retry backoff must spread a recovering dependency's load.
 *
 * The previous schedule was purely deterministic (60s, 120s, 240s …), so every
 * event that failed during one incident retried at the same instant. When the
 * dependency came back the whole backlog hit it simultaneously and could knock it
 * over again — the thundering herd that retries exist to prevent.
 */

const BASE = 60;
const CAP = 3600;

describe('outbox retry backoff', () => {
  it('keeps a floor of half the deterministic delay', () => {
    // Full jitter (random across the whole window) can retry almost immediately,
    // which for an outbox means hammering a service that is still failing.
    for (let attempt = 0; attempt < 6; attempt++) {
      const expectedCap = Math.min(BASE * 2 ** attempt, CAP);
      expect(computeBackoffSeconds(attempt, () => 0)).toBe(Math.round(expectedCap / 2));
    }
  });

  it('never exceeds the deterministic delay it replaces', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const expectedCap = Math.min(BASE * 2 ** attempt, CAP);
      expect(computeBackoffSeconds(attempt, () => 1)).toBeLessThanOrEqual(expectedCap);
    }
  });

  it('respects the one-hour cap at high attempt counts', () => {
    // 60 * 2^20 is astronomically large; the cap must hold.
    expect(computeBackoffSeconds(20, () => 1)).toBeLessThanOrEqual(CAP);
    expect(computeBackoffSeconds(20, () => 0)).toBe(CAP / 2);
  });

  it('still grows exponentially before the cap', () => {
    const mid = () => 0.5;
    const delays = [0, 1, 2, 3, 4].map((a) => computeBackoffSeconds(a, mid));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it('spreads a herd that failed together instead of stacking it on one instant', () => {
    // 500 events failing in the same incident, at the same attempt count.
    const delays = Array.from({ length: 500 }, () => computeBackoffSeconds(3, Math.random));
    const distinct = new Set(delays);

    // Deterministic backoff would produce exactly one value.
    expect(distinct.size).toBeGreaterThan(100);

    const cap = Math.min(BASE * 2 ** 3, CAP);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(cap / 2);
    expect(Math.max(...delays)).toBeLessThanOrEqual(cap);

    // No single instant should carry a large share of the backlog.
    const counts = new Map<number, number>();
    for (const d of delays) counts.set(d, (counts.get(d) ?? 0) + 1);
    expect(Math.max(...counts.values()) / delays.length).toBeLessThan(0.1);
  });

  it('returns whole seconds — a fractional delay is meaningless to the scheduler', () => {
    for (let i = 0; i < 50; i++) {
      const value = computeBackoffSeconds(2, Math.random);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('is deterministic when the RNG is', () => {
    expect(computeBackoffSeconds(4, () => 0.25)).toBe(computeBackoffSeconds(4, () => 0.25));
  });
});
