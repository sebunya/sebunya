import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TELEMETRY_TRUSTED_FROM, TELEMETRY_TRUSTED_FROM_DAY } from '../../apps/api/src/domain/measurement/Outcomes';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/**
 * Telemetry before 2026-10-24 is our own audits (254 of 260 checkout starts in 90 days were Playwright engines).
 * Both Outcomes readers must start there, or the page and the goal suggestions anchor to lab browsers.
 */
describe('telemetry is trusted from 24 October 2026', () => {
  it('the day and the instant agree (midnight Kampala)', () => {
    expect(TELEMETRY_TRUSTED_FROM_DAY).toBe('2026-10-24');
    expect(TELEMETRY_TRUSTED_FROM.toISOString()).toBe('2026-10-23T21:00:00.000Z');
  });
  it('the Outcomes reader clips the whole window and reports it', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleOutcomesReader.ts');
    expect(src).toContain('const start = clipped ? TELEMETRY_TRUSTED_FROM : requestedStart;');
    expect(src).toContain("countedFrom: clipped && end > TELEMETRY_TRUSTED_FROM ? TELEMETRY_TRUSTED_FROM_DAY : null");
    expect(src).not.toContain('${requestedStart}');
    expect(src).not.toContain('${requestedStartDay}');
  });
  it('every suggestion series starts at the trusted day', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleOutcomeSuggestionReader.ts');
    expect(src).toContain('TELEMETRY_TRUSTED_FROM.getTime()');
    expect(src.match(/\$\{since\}/g)?.length).toBe(4);
  });
  it('the page says so', () => {
    expect(read('apps/web/src/pages/admin/analytics/outcomes.astro')).toContain('Counted from {data.countedFrom}');
  });
});
