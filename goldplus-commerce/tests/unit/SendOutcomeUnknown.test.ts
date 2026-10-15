import { describe, it, expect } from 'vitest';
import { sendMayHaveReachedProvider, CircuitBreakerError } from '../../apps/api/src/infrastructure/http/HttpClient';

/**
 * The SMS and email adapters returned a retryable failure on a timeout. The outbox retries up to eight times,
 * so a message egosms or ZeptoMail had accepted but answered slowly was sent again on every retry (and, as an
 * SMS fallback, also went out on WhatsApp). The Meta adapter already knew better; the rule now lives in one place.
 */
const err = (name: string, message = 'x', code?: string) => Object.assign(new Error(message), { name }, code ? { cause: { code } } : {});

describe('could a failed send have reached the provider?', () => {
  it('yes after a timeout, a broken connection or an unreadable answer', () => {
    expect(sendMayHaveReachedProvider(err('AbortError'))).toBe(true);
    expect(sendMayHaveReachedProvider(err('TimeoutError'))).toBe(true);
    expect(sendMayHaveReachedProvider(err('TypeError', 'fetch failed', 'ECONNRESET'))).toBe(true);
    expect(sendMayHaveReachedProvider(err('TypeError', 'fetch failed', 'UND_ERR_SOCKET'))).toBe(true);
    expect(sendMayHaveReachedProvider(new SyntaxError('Unexpected token < in JSON'))).toBe(true);
  });

  it('no when nothing left: open breaker, SSRF block, refused, DNS, TLS, connect timeout', () => {
    expect(sendMayHaveReachedProvider(new CircuitBreakerError("Circuit breaker 'egosms' is OPEN"))).toBe(false);
    expect(sendMayHaveReachedProvider(new Error('SSRF Block: Hostname x resolved to private IP: 10.0.0.1'))).toBe(false);
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
      expect(sendMayHaveReachedProvider(err('TypeError', 'fetch failed', code)), code).toBe(false);
    }
  });

  it("no on the provider's own error status (it answered: the request was refused, not lost)", () => {
    expect(sendMayHaveReachedProvider(new Error('HTTP error status 503'))).toBe(false);
  });
});
