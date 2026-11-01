import pino from 'pino';
import { traceLocalStorage } from '../observability/TraceContext';

/**
 * Redaction paths (Slice 3E). Anything under these keys is censored before it
 * reaches a log sink, so a secret or PII that rides along on an error, a request
 * object or a bound-parameter blob never lands in a log that is retained far
 * longer than the request. Paths cover common nestings (err/req/headers/body).
 */
const REDACT_KEYS = [
  'password', 'passwordHash', 'token', 'accessToken', 'refreshToken', 'refresh_token',
  'authorization', 'Authorization', 'cookie', 'Cookie', 'secret', 'jwt', 'jwtSecret',
  'pepper', 'apiKey', 'api_key', 'clientSecret', 'consumerSecret', 'accountNumber',
  'cardNumber', 'cvv', 'pin', 'ssn', 'email', 'phone',
];
export const REDACT_PATHS = REDACT_KEYS.flatMap((k) => [
  k,
  `*.${k}`,
  `err.${k}`,
  `req.headers.${k}`,
  `req.body.${k}`,
  `body.${k}`,
  `headers.${k}`,
  `*.headers.${k}`,
]).concat(
  // Hyphenated secret HEADERS need bracket paths. The storefront's internal key
  // was logged in clear on every SSR request for an hour after it shipped
  // (2026-09-18) because only dotted keys were listed.
  // The storefront's bearer credentials go the same way: the signed cart credential
  // (full authority over a guest basket), the checkout intent, the HttpOnly visit
  // token, and the machine tokens and signatures (2026-09-24).
  [
    'x-goldplus-internal-key',
    'x-api-key',
    'x-goldplus-cart',
    'x-goldplus-checkout-intent',
    'x-gp-visit',
    'x-lighthouse-watch-token',
    'x-product-finder-access-token',
    'x-goldplus-signature',
    'x-goog-api-key',
  ].flatMap((h) => [
    `req.headers["${h}"]`,
    `headers["${h}"]`,
    `*.headers["${h}"]`,
  ]),
);

// Initialize Structured Logger with dynamic context injection
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  mixin() {
    const store = traceLocalStorage.getStore();
    const workerInstance = process.env.HOSTNAME || 'api-node-1';
    
    if (store) {
      return {
        traceId: store.traceId,
        spanId: store.spanId,
        jobId: store.jobId,
        userId: store.userId,
        workerInstance,
      };
    }
    
    return {
      workerInstance,
    };
  },
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
});
