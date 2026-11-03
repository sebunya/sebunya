import { describe, expect, it } from 'vitest';
import { parseExclusionArgs, parsePhoneHygieneArgs } from './firstPartyOpsArgs';

const RUN = '0b0e7c1a-1234-4abc-9def-0123456789ab';

describe('parsePhoneHygieneArgs', () => {
  it('a bare --revert is an error and never APPLY', () => {
    for (const argv of [['--revert', '--apply'], ['--revert'], ['--revert=', '--apply'], ['--apply', '--revert']]) {
      const a = parsePhoneHygieneArgs(argv);
      expect(a.errors.length).toBeGreaterThan(0);
      expect(a.mode).toBe('REVERT');
      expect(a.applyRevert).toBe(false);
    }
  });
  it('--revert=<run> --apply carries the revert out', () => {
    const a = parsePhoneHygieneArgs([`--revert=${RUN}`, '--apply']);
    expect(a).toMatchObject({ mode: 'REVERT', applyRevert: true, revertRunId: RUN, errors: [] });
    expect(parsePhoneHygieneArgs(['--revert', RUN])).toMatchObject({ mode: 'REVERT', applyRevert: false, errors: [] });
  });
  it('plain runs are unchanged', () => {
    expect(parsePhoneHygieneArgs([])).toMatchObject({ mode: 'DRY_RUN', errors: [] });
    expect(parsePhoneHygieneArgs(['--apply'])).toMatchObject({ mode: 'APPLY', errors: [] });
  });
  it('a bare --show is an error', () => {
    expect(parsePhoneHygieneArgs(['--show', '--apply']).errors).toContain('--show needs a value');
  });
});

describe('parseExclusionArgs', () => {
  it('a bare --revert is an error and never APPLY', () => {
    const a = parseExclusionArgs(['--revert', '--apply']);
    expect(a.errors).toContain('--revert needs a value');
    expect(a.mode).toBe('REVERT');
    expect(a.applyRevert).toBe(false);
  });
  it('a bare value flag is an error', () => {
    for (const flag of ['--rules', '--batch', '--pause-ms', '--from', '--to', '--actor']) {
      expect(parseExclusionArgs([flag, '--apply']).errors).toContain(`${flag} needs a value`);
      expect(parseExclusionArgs([`${flag}=`, '--apply']).errors).toContain(`${flag} needs a value`);
    }
  });
  it('valid forms still parse', () => {
    expect(parseExclusionArgs(['--apply', '--rules=a,b', '--batch', '1000'])).toMatchObject({ mode: 'APPLY', rules: ['a', 'b'], batchSize: 1000, errors: [] });
    expect(parseExclusionArgs([`--revert=${RUN}`, '--apply'])).toMatchObject({ mode: 'REVERT', applyRevert: true, errors: [] });
    expect(parseExclusionArgs([])).toMatchObject({ mode: 'DRY_RUN', errors: [] });
  });
});
