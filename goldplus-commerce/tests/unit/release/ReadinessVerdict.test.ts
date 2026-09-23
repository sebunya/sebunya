import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readinessVerdict } from '../../../apps/api/src/domain/release/ReadinessVerdict';
import { SafeReleaseReadinessCheckRunner } from '../../../apps/api/src/infrastructure/release/SafeReleaseReadinessCheckRunner';

/**
 * A readiness run is PASS only when its checks RAN and passed. It used to be
 * recorded PASS when every check came back NOT_CONFIGURED, and the admin banner
 * then read "READY: All safe checks passed" for a run that checked nothing.
 */
describe('readiness verdict', () => {
  it('passes only when checks ran and passed', () => {
    expect(readinessVerdict(['PASS', 'PASS'])).toBe('PASS');
    expect(readinessVerdict(['PASS', 'NOT_APPLICABLE'])).toBe('PASS');
  });
  it('a check that did not run is never a pass', () => {
    expect(readinessVerdict(['NOT_CONFIGURED', 'NOT_CONFIGURED', 'NOT_CONFIGURED'])).toBe('UNKNOWN');
    expect(readinessVerdict(['PASS', 'NOT_CONFIGURED'])).toBe('UNKNOWN');
    expect(readinessVerdict(['PASS', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(readinessVerdict([])).toBe('UNKNOWN');
    expect(readinessVerdict(['NOT_APPLICABLE'])).toBe('UNKNOWN');
  });
  it('failure outranks warning outranks not-run', () => {
    expect(readinessVerdict(['PASS', 'WARN', 'NOT_CONFIGURED'])).toBe('WARN');
    expect(readinessVerdict(['WARN', 'BLOCKED'])).toBe('FAIL');
    expect(readinessVerdict(['NOT_CONFIGURED', 'FAIL'])).toBe('FAIL');
  });
});

describe('source checks on a server without source tooling', () => {
  it('report NOT_CONFIGURED instead of recording failures, and run nothing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gp-release-'));
    {
      const runner = new SafeReleaseReadinessCheckRunner({ redactCommandOutput: (s: string) => s } as never, empty);
      const results = await runner.runAll();
      expect(Object.keys(results)).toEqual(['CODE:TYPECHECK', 'TEST:ARCHITECTURE', 'TEST:UNIT']);
      for (const r of Object.values(results)) {
        expect(r.status).toBe('NOT_CONFIGURED');
        expect(r.evidence.reason).toMatch(/cannot run here/);
      }
      expect(readinessVerdict(Object.values(results).map((r) => r.status))).toBe('UNKNOWN');
    }
  });
});
