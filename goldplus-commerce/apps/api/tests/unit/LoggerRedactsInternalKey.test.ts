import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { REDACT_PATHS } from '../../src/infrastructure/logging/logger';

/** The storefront's internal API key must never reach a log line (2026-09-18). */
describe('logger redaction', () => {
  it('censors the internal key header on a logged request, keeps the rest', () => {
    const lines: string[] = [];
    const sink = new Writable({ write(c, _e, cb) { lines.push(String(c)); cb(); } });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink);
    log.info({ req: { headers: { 'x-goldplus-internal-key': 'SECRET-VALUE', authorization: 'Bearer T', host: 'api:3000' } } }, 'Request completed');
    const out = lines.join('');
    expect(out).not.toContain('SECRET-VALUE');
    expect(out).not.toContain('Bearer T');
    expect(out).toContain('api:3000');
  });
});
