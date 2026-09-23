import { exec } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { CheckRunnerResult, IReleaseReadinessCheckRunner } from '../../application/ports/release/ReleaseReadinessCheckRunner';
import { IReleaseEvidenceRedactor } from '../../application/ports/release/ReleaseEvidenceRedactor';

const execAsync = promisify(exec);

export class SafeReleaseReadinessCheckRunner implements IReleaseReadinessCheckRunner {
  constructor(
    private readonly redactor: IReleaseEvidenceRedactor,
    /** Where the repository is: the nearest folder with pnpm-workspace.yaml above the working directory. */
    private readonly root: string = findRepoRoot(process.cwd()),
  ) {}

  private async runSafeCommand(command: string, timeoutMs: number = 30000): Promise<{ stdout: string; stderr: string; code: number; timedOut?: boolean }> {
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: timeoutMs, cwd: this.root });
      return {
        stdout: this.redactor.redactCommandOutput(stdout),
        stderr: this.redactor.redactCommandOutput(stderr),
        code: 0,
      };
    } catch (error: any) {
      return {
        stdout: this.redactor.redactCommandOutput(error.stdout || ''),
        stderr: this.redactor.redactCommandOutput(error.stderr || error.message),
        code: error.code || 1,
        // Killed by the timeout: the check did not finish, which is not the same as failing.
        timedOut: Boolean(error.killed),
      };
    }
  }

  async runCheck(gateId: string): Promise<CheckRunnerResult> {
    switch (gateId) {
      case 'CODE:TYPECHECK':
        return this.runTypecheck();
      case 'TEST:ARCHITECTURE':
        return this.runArchitectureTests();
      case 'TEST:UNIT':
        return this.runUnitTests();
      default:
        return {
          status: 'NOT_CONFIGURED',
          severity: 'MEDIUM',
          evidence: { error: `Check ${gateId} is not configured or recognized.` },
          source: 'SafeReleaseReadinessCheckRunner',
        };
    }
  }

  async runCategory(category: string): Promise<Record<string, CheckRunnerResult>> {
    const allChecks = await this.runAll();
    const filtered: Record<string, CheckRunnerResult> = {};
    for (const [key, value] of Object.entries(allChecks)) {
      if (key.startsWith(`${category}:`)) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  /**
   * Source checks need the source. The production API image carries only the
   * compiled server and its production dependencies — no tests, no TypeScript,
   * no vitest — so every command below would "fail" there and the run would be
   * recorded as critical failures that are really "cannot run here". Each check
   * reports NOT_CONFIGURED instead; the checks themselves run in CI and on a
   * developer machine.
   */
  private sourceTooling(): { ok: true } | { ok: false; result: CheckRunnerResult } {
    const missing = ['package.json', 'tsconfig.base.json', 'tests/architecture', 'node_modules/.bin/vitest'].filter((p) => !existsSync(join(this.root, p)));
    if (missing.length === 0) return { ok: true };
    return {
      ok: false,
      result: {
        status: 'NOT_CONFIGURED',
        severity: 'MEDIUM',
        evidence: { reason: 'This server has no source or test tooling, so source checks cannot run here. They run in CI and on a developer machine.', missing },
        source: 'SafeReleaseReadinessCheckRunner',
      },
    };
  }

  async runAll(): Promise<Record<string, CheckRunnerResult>> {
    const results: Record<string, CheckRunnerResult> = {};
    results['CODE:TYPECHECK'] = await this.runTypecheck();
    results['TEST:ARCHITECTURE'] = await this.runArchitectureTests();
    results['TEST:UNIT'] = await this.runUnitTests();
    return results;
  }

  getSupportedChecks(): string[] {
    return [
      'CODE:TYPECHECK',
      'TEST:ARCHITECTURE',
      'TEST:UNIT',
    ];
  }

  private async runTypecheck(): Promise<CheckRunnerResult> {
    const tooling = this.sourceTooling();
    if (!tooling.ok) return tooling.result;
    const result = await this.runSafeCommand('pnpm run typecheck', 240000);
    return {
      status: result.timedOut ? 'UNKNOWN' : result.code === 0 ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      evidence: { stdout: result.stdout, stderr: result.stderr },
      source: 'tsc',
    };
  }

  private async runArchitectureTests(): Promise<CheckRunnerResult> {
    const tooling = this.sourceTooling();
    if (!tooling.ok) return tooling.result;
    const result = await this.runSafeCommand('pnpm vitest run tests/architecture/', 120000);
    return {
      status: result.timedOut ? 'UNKNOWN' : result.code === 0 ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      evidence: { stdout: result.stdout, stderr: result.stderr },
      source: 'vitest',
    };
  }

  private async runUnitTests(): Promise<CheckRunnerResult> {
    const tooling = this.sourceTooling();
    if (!tooling.ok) return tooling.result;
    // The release module's own unit tests: a bounded subset, well inside the timeout.
    const result = await this.runSafeCommand('pnpm vitest run tests/unit/release/', 60000);
    return {
      status: result.timedOut ? 'UNKNOWN' : result.code === 0 ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      evidence: { stdout: result.stdout, stderr: result.stderr },
      source: 'vitest',
    };
  }
}

/** The monorepo root (the API may run from apps/api); the start folder itself when none is found, e.g. in the production image. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}
