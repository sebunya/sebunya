import { describe, expect, it } from 'vitest';
import { evaluateRateLimit } from '../../apps/api/src/domain/security/RateLimit';
import {
  assessLoginRisk,
  evaluateLoginThrottle,
  assessOrderRisk,
} from '../../apps/api/src/domain/security/RiskEngine';
import { InMemoryRateLimitStore } from '../../apps/api/src/infrastructure/security/InMemoryRateLimitStore';

describe('rate limit', () => {
  it('allows up to the limit then blocks with a retry-after', () => {
    const start = 1_000_000;
    const rule = { limit: 3, windowSeconds: 60 };
    expect(evaluateRateLimit(rule, 1, start, start).allowed).toBe(true);
    expect(evaluateRateLimit(rule, 3, start, start).allowed).toBe(true);
    const blocked = evaluateRateLimit(rule, 4, start, start + 10_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(50);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after the window elapses (in-memory store)', () => {
    const store = new InMemoryRateLimitStore();
    const rule = { limit: 2, windowSeconds: 1 };
    expect(store.hit('k', rule, 0).allowed).toBe(true);
    expect(store.hit('k', rule, 0).allowed).toBe(true);
    expect(store.hit('k', rule, 0).allowed).toBe(false); // 3rd in window
    expect(store.hit('k', rule, 2000).allowed).toBe(true); // new window
  });

  it('keys are independent', () => {
    const store = new InMemoryRateLimitStore();
    const rule = { limit: 1, windowSeconds: 60 };
    expect(store.hit('a', rule, 0).allowed).toBe(true);
    expect(store.hit('b', rule, 0).allowed).toBe(true);
    expect(store.hit('a', rule, 0).allowed).toBe(false);
  });
});

describe('login throttle', () => {
  it('locks at the failure threshold', () => {
    expect(evaluateLoginThrottle(7).locked).toBe(false);
    expect(evaluateLoginThrottle(8).locked).toBe(true);
    expect(evaluateLoginThrottle(8).retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('login risk scoring', () => {
  it('is low-risk for a known device with no failures', () => {
    const r = assessLoginRisk({ recentFailuresForEmail: 0, recentFailuresForIp: 0, knownDevice: true, recentOtpFailures: 0 });
    expect(r.decision).toBe('allow');
    expect(r.score).toBe(0);
  });

  it('escalates to challenge or deny as signals stack up', () => {
    const r = assessLoginRisk({ recentFailuresForEmail: 4, recentFailuresForIp: 12, knownDevice: false, recentOtpFailures: 0 });
    expect(r.score).toBeGreaterThanOrEqual(45);
    expect(['challenge', 'deny']).toContain(r.decision);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('caps the score at 100', () => {
    const r = assessLoginRisk({ recentFailuresForEmail: 50, recentFailuresForIp: 50, knownDevice: false, recentOtpFailures: 10 });
    expect(r.score).toBe(100);
    expect(r.decision).toBe('deny');
  });
});

describe('order risk scoring', () => {
  it('allows normal purchasing', () => {
    expect(assessOrderRisk({ ordersLastHour: 1, ordersLastDay: 2 }).decision).toBe('allow');
  });

  it('denies automated-looking bursts outright', () => {
    const r = assessOrderRisk({ ordersLastHour: 10, ordersLastDay: 12 });
    expect(r.decision).toBe('deny');
    expect(r.score).toBe(100);
  });

  it('flags elevated but not blatant velocity as challenge', () => {
    const r = assessOrderRisk({ ordersLastHour: 5, ordersLastDay: 16, distinctPhonesLastDay: 4 });
    expect(['challenge', 'deny']).toContain(r.decision);
  });
});
