import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerError } from '../../apps/api/src/infrastructure/http/HttpClient';

describe('CircuitBreaker Unit Tests', () => {
  it('should transition to OPEN after threshold failures, then cool down', async () => {
    const breaker = new CircuitBreaker('test-service', 3, 50); // threshold = 3, cooldown = 50ms
    expect(breaker.getState()).toBe('CLOSED');

    const failingAction = () => Promise.reject(new Error('Network error'));

    // 1st failure
    await expect(breaker.run(failingAction)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe('CLOSED');

    // 2nd failure
    await expect(breaker.run(failingAction)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe('CLOSED');

    // 3rd failure - opens the breaker
    await expect(breaker.run(failingAction)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe('OPEN');

    // Subsequent calls fail-fast with CircuitBreakerError
    await expect(breaker.run(failingAction)).rejects.toThrow(CircuitBreakerError);

    // Test fallback
    const fallback = () => Promise.resolve('fallback-value');
    const fallbackResult = await breaker.run(failingAction, fallback);
    expect(fallbackResult).toBe('fallback-value');

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Next request should transition to HALF_OPEN
    const successAction = () => Promise.resolve('success-value');
    const successResult = await breaker.run(successAction);
    expect(successResult).toBe('success-value');
    expect(breaker.getState()).toBe('CLOSED');
  });
});
