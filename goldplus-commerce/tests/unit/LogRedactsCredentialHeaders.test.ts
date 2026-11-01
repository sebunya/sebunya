import { describe, expect, it } from 'vitest';
import pino from '../../apps/api/node_modules/pino';
import { Writable } from 'node:stream';
import { REDACT_PATHS } from '../../apps/api/src/infrastructure/logging/logger';

/**
 * hono-pino binds every request header to every request log line. Only
 * authorization, cookie and two machine keys were redacted, so the signed cart
 * credential, the checkout intent, the HttpOnly visit token and the machine
 * tokens were written in clear.
 */
const CREDENTIAL_HEADERS = [
  'x-goldplus-cart',
  'x-goldplus-checkout-intent',
  'x-gp-visit',
  'x-lighthouse-watch-token',
  'x-product-finder-access-token',
  'x-goldplus-signature',
  'x-goldplus-internal-key',
];

function capture(obj: object): string {
  let out = '';
  const sink = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink).info(obj, 'request');
  return out;
}

describe('request logs never carry credential headers', () => {
  const headers = Object.fromEntries(CREDENTIAL_HEADERS.map((h) => [h, `secret-${h}`]));

  it.each([
    ['req.headers', { req: { headers } }],
    ['headers', { headers }],
    ['*.headers', { request: { headers } }],
  ])('redacts under %s', (_label, obj) => {
    const line = capture(obj);
    for (const h of CREDENTIAL_HEADERS) expect(line).not.toContain(`secret-${h}`);
    expect(line).toContain('[redacted]');
  });

  it('leaves ordinary headers readable', () => {
    expect(capture({ req: { headers: { 'user-agent': 'probe/1' } } })).toContain('probe/1');
  });
});
