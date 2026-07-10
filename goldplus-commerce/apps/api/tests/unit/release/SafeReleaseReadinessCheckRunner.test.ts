import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SafeReleaseReadinessCheckRunner } from '../../../src/infrastructure/release/SafeReleaseReadinessCheckRunner';
import { IReleaseEvidenceRedactor } from '../../../src/application/ports/release/ReleaseEvidenceRedactor';

const { mockExecAsync } = vi.hoisted(() => {
  return { mockExecAsync: vi.fn() };
});

vi.mock('util', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    promisify: () => mockExecAsync
  };
});

describe('SafeReleaseReadinessCheckRunner', () => {
  let runner: SafeReleaseReadinessCheckRunner;
  let redactor: import('vitest').Mocked<IReleaseEvidenceRedactor>;

  beforeEach(() => {
    redactor = {
      redactCommandOutput: vi.fn((str) => str ? str.replace(/secret/g, '[REDACTED]') : ''),
      redactEvidence: vi.fn((obj) => obj),
      redactMetadata: vi.fn((obj) => obj),
    };
    runner = new SafeReleaseReadinessCheckRunner(redactor);
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: 'Typecheck passed', stderr: '' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs allowed checks safely', async () => {
    const result = await runner.runCheck('CODE:TYPECHECK');
    expect(result.status).toBe('PASS');
    expect(result.evidence.stdout).toBe('Typecheck passed');
  });

  it('rejects unknown check IDs', async () => {
    const res = await runner.runCheck('UNKNOWN_CHECK_ID');
    expect(res.status).toBe('NOT_CONFIGURED');
  });

  it('rejects forbidden operations implicitly since it uses a strict allowlist', async () => {
    let res = await runner.runCheck('rm -rf /');
    expect(res.status).toBe('NOT_CONFIGURED');
    
    res = await runner.runCheck('git push');
    expect(res.status).toBe('NOT_CONFIGURED');
  });

  it('captures exit code and maps to FAIL on error', async () => {
    const err = new Error('failed');
    (err as any).code = 123;
    (err as any).stderr = 'err';
    mockExecAsync.mockRejectedValueOnce(err);

    const result = await runner.runCheck('CODE:TYPECHECK');
    expect(result.status).toBe('FAIL');
    expect(result.evidence.stderr).toBe('err');
  });

  it('redacts command output before returning', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: 'My secret is here', stderr: '' });

    // Assuming LINT is an allowed check (not implemented yet, but let's test directly on runSafeCommand)
    const result = await (runner as any).runSafeCommand('dummy command');
    
    expect(redactor.redactCommandOutput).toHaveBeenCalledWith('My secret is here');
    expect(result.stdout).toBe('My [REDACTED] is here');
  });
});
