import { describe, it, expect } from 'vitest';

/**
 * A SKIPPED INTEGRATION TEST FAILS THE BUILD (payments brief, 2026-08-06).
 *
 * Roughly fifty of the 111 integration tests had never executed anywhere. The
 * payment machinery shipped and stayed unproven for months, and the suites
 * that would have exercised its neighbours sat in `describe.skip` behind
 * missing environment variables — a note, not coverage, reading as green.
 *
 * Every integration suite gates itself on one of the variables below and skips
 * silently without it. This file is the opposite: it FAILS, loudly, naming
 * exactly what to run. So a full-suite run either executes all 111 or goes
 * red — it can no longer quietly report green minus the tests that matter.
 *
 *   ./scripts/integration-env.sh            # stand everything up and run
 *   ./scripts/integration-env.sh npx vitest run   # full suite with services
 *
 * There is deliberately NO escape hatch. The last one was called
 * `describe.skip`.
 */

const REQUIRED = [
  'DATABASE_URL',
  'COMMERCE_TEST_DATABASE_URL',
  'AUTH_TEST_DATABASE_URL',
  'ANALYTICS_TEST_DATABASE_URL',
  'REDIS_TEST_URL',
] as const;

describe('integration environment gate — zero skipped tests', () => {
  it('every service the 111 integration tests need is present', () => {
    const missing = REQUIRED.filter((key) => !(process.env[key] ?? '').trim());
    expect(
      missing,
      `The integration environment is not up, so the suites behind these variables would SKIP ` +
        `and this run would report green minus the coverage that matters. Missing: ${missing.join(', ')}. ` +
        `Run ./scripts/integration-env.sh (once per machine; it reuses the databases).`,
    ).toEqual([]);
  });
});
