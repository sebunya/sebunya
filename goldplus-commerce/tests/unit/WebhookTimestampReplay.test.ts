import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import app from '../../apps/api/src/interfaces/http/app';
import {
  isWebhookTimestampFresh,
  WEBHOOK_TS_MAX_AGE_MS,
  WEBHOOK_TS_MAX_FUTURE_MS,
} from '../../apps/api/src/domain/payments/WebhookVerificationPolicy';

describe('isWebhookTimestampFresh — replay window (P0-1)', () => {
  const now = 1_760_000_000_000;
  const nowSec = Math.floor(now / 1000);
  it('accepts a current timestamp', () => {
    expect(isWebhookTimestampFresh(nowSec, now)).toBe(true);
  });
  it('rejects a timestamp older than the max age', () => {
    expect(isWebhookTimestampFresh(nowSec - (WEBHOOK_TS_MAX_AGE_MS / 1000 + 1), now)).toBe(false);
  });
  it('rejects a timestamp too far in the future', () => {
    expect(isWebhookTimestampFresh(nowSec + (WEBHOOK_TS_MAX_FUTURE_MS / 1000 + 1), now)).toBe(false);
  });
  it('accepts within the future skew tolerance and rejects non-finite', () => {
    expect(isWebhookTimestampFresh(nowSec + 30, now)).toBe(true);
    expect(isWebhookTimestampFresh(NaN, now)).toBe(false);
  });
});

describe('P0-1 AC2 — a signed webhook with a stale timestamp returns 401', () => {
  it('rejects a stale-timestamp webhook with 401 before any processing', async () => {
    const rawBody = JSON.stringify({ orderId: 'o1', amount: 1000, outcome: 'SUCCESS' });
    const staleTs = String(Math.floor(Date.now() / 1000) - 3600); // 1 hour old
    // Sign timestamp.rawBody exactly as a compliant provider would.
    const sig = createHmac('sha256', 'test-secret').update(`${staleTs}.${rawBody}`).digest('hex');
    const res = await app.request('/webhooks/payment/mtn', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goldplus-timestamp': staleTs,
        'x-goldplus-signature': sig,
      },
      body: rawBody,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('STALE_TIMESTAMP');
  });

  it('a fresh timestamp does not trip the stale check (proceeds past 401-stale)', async () => {
    const rawBody = JSON.stringify({ orderId: 'nonexistent', amount: 1000, outcome: 'SUCCESS' });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', 'x').update(`${ts}.${rawBody}`).digest('hex');
    const res = await app.request('/webhooks/payment/mtn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goldplus-timestamp': ts, 'x-goldplus-signature': sig },
      body: rawBody,
    });
    // Not the stale-timestamp 401 (it may be a signature 401/503 or 422, but the
    // code is never STALE_TIMESTAMP for a fresh timestamp).
    const body = await res.json().catch(() => ({}));
    expect(body?.error?.code).not.toBe('STALE_TIMESTAMP');
  });
});
