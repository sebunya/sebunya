import { logger } from '../logging/logger';
import * as client from 'prom-client';
import dns from 'node:dns';
import { promisify } from 'node:util';

const dnsLookup = promisify(dns.lookup);

export function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('127.') || ip === '0.0.0.0' || ip === '169.254.169.254') return true;

  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }

  const ipL = ip.toLowerCase();
  if (ipL === '::1' || ipL === '::' || ipL.startsWith('fe80:') || ipL.startsWith('fc00:') || ipL.startsWith('fd00:')) {
    return true;
  }

  return false;
}

// Prometheus Metrics for Circuit Breakers
const circuitBreakerState = new client.Gauge({
  name: 'goldplus_circuit_breaker_state',
  help: 'Circuit breaker state (0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN)',
  labelNames: ['breaker_name'],
});

const circuitBreakerFailures = new client.Counter({
  name: 'goldplus_circuit_breaker_failures_total',
  help: 'Total number of circuit breaker failure events',
  labelNames: ['breaker_name'],
});

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private nextAttemptTime = 0;

  constructor(
    public readonly name: string,
    private readonly failureThreshold = 5,
    private readonly cooldownPeriodMs = 30000
  ) {
    // Initialize gauge in closed state
    circuitBreakerState.set({ breaker_name: name }, 0);
  }

  async run<T>(action: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (this.state === 'OPEN') {
      if (now >= this.nextAttemptTime) {
        this.state = 'HALF_OPEN';
        circuitBreakerState.set({ breaker_name: this.name }, 1);
        logger.warn({ breaker: this.name }, `[CircuitBreaker] Transitioned to HALF_OPEN. Testing next request.`);
      } else {
        if (fallback) {
          logger.warn({ breaker: this.name }, `[CircuitBreaker] Breaker is OPEN. Executing fallback.`);
          return fallback();
        }
        throw new CircuitBreakerError(`Circuit breaker '${this.name}' is OPEN`);
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (err: any) {
      this.onFailure(err);
      if (fallback) {
        logger.warn({ breaker: this.name, err: err.message }, `[CircuitBreaker] Request failed. Executing fallback.`);
        return fallback();
      }
      throw err;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      circuitBreakerState.set({ breaker_name: this.name }, 0);
      logger.info({ breaker: this.name }, `[CircuitBreaker] Service recovered. Transitioned to CLOSED.`);
    }
  }

  private onFailure(err: any) {
    this.failureCount++;
    circuitBreakerFailures.inc({ breaker_name: this.name });
    logger.warn(
      { breaker: this.name, failures: this.failureCount, err: err.message },
      `[CircuitBreaker] Execution failed`
    );

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.cooldownPeriodMs;
      circuitBreakerState.set({ breaker_name: this.name }, 2);
      logger.error(
        { breaker: this.name, cooldownMs: this.cooldownPeriodMs },
        `[CircuitBreaker] Service is failing. Transitioned to OPEN.`
      );
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }
}

// Global registry of circuit breakers by domain/service
export const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(name: string, threshold = 5, cooldown = 30000): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker(name, threshold, cooldown);
    breakers.set(name, b);
  }
  return b;
}

export async function resilientFetch(
  url: string,
  options: RequestInit & { timeoutMs?: number; breakerName?: string; fallback?: () => Promise<any> }
): Promise<Response> {
  const { timeoutMs = 3000, breakerName = new URL(url).hostname, fallback, ...rest } = options;

  // SSRF Destination Validation Guard
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const metricsHost = process.env.METRICS_INTERNAL_URL 
    ? new URL(process.env.METRICS_INTERNAL_URL).hostname.toLowerCase()
    : 'sgtm-production';
  const ssrfAllowlist = ['sgtm-production', 'localhost', '127.0.0.1', metricsHost];

  const isAllowedHost = ssrfAllowlist.includes(hostname);

  if (!isAllowedHost) {
    try {
      const { address } = await dnsLookup(parsed.hostname);
      if (isPrivateIp(address)) {
        const ssrfErr = new Error(`SSRF Block: Hostname ${parsed.hostname} resolved to private IP: ${address}`);
        logger.error({ url, err: ssrfErr.message }, '[SSRF] Outbound request blocked');
        throw ssrfErr;
      }
    } catch (dnsErr: any) {
      if (dnsErr.message.includes('SSRF Block')) {
        throw dnsErr;
      }
      // DNS resolution failed or cannot resolve, let fetch throw naturally
    }
  }

  const breaker = getBreaker(breakerName);

  const fetchAction = async () => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...rest,
        signal: controller.signal
      });
      clearTimeout(id);

      if (!response.ok && response.status >= 500) {
        throw new Error(`HTTP error status ${response.status}`);
      }
      return response;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  };

  return breaker.run(fetchAction, fallback);
}
