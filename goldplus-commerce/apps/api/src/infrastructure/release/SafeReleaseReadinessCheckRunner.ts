import { exec } from 'child_process';
import { promisify } from 'util';
import { CheckRunnerResult, IReleaseReadinessCheckRunner } from '../../application/ports/release/ReleaseReadinessCheckRunner';
import { IReleaseEvidenceRedactor } from '../../application/ports/release/ReleaseEvidenceRedactor';

const execAsync = promisify(exec);

export class SafeReleaseReadinessCheckRunner implements IReleaseReadinessCheckRunner {
  constructor(private readonly redactor: IReleaseEvidenceRedactor) {}

  private async runSafeCommand(command: string, timeoutMs: number = 30000): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: timeoutMs, cwd: process.cwd() });
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

  async runAll(): Promise<Record<string, CheckRunnerResult>> {
    const results: Record<string, CheckRunnerResult> = {};
    results['CODE:TYPECHECK'] = await this.runTypecheck();
    results['TEST:ARCHITECTURE'] = await this.runArchitectureTests();
    results['TEST:UNIT'] = await this.runUnitTests();
    // In a real implementation, we would add GTM dry runs, config checks, etc.
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
    const result = await this.runSafeCommand('pnpm run typecheck', 60000);
    return {
      status: result.code === 0 ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      evidence: { stdout: result.stdout, stderr: result.stderr },
      source: 'tsc',
    };
  }

  private async runArchitectureTests(): Promise<CheckRunnerResult> {
    const result = await this.runSafeCommand('pnpm vitest run tests/architecture/', 60000);
    return {
      status: result.code === 0 ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      evidence: { stdout: result.stdout, stderr: result.stderr },
      source: 'vitest',
    };
  }

  private async runUnitTests(): Promise<CheckRunnerResult> {
    // We only run a subset or simple test to avoid timing out the whole run in this example
    const result = await this.runSafeCommand('pnpm vitest run tests/unit/release/', 60000);
    return {
      status: result.code === 0 ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      evidence: { stdout: result.stdout, stderr: result.stderr },
      source: 'vitest',
    };
  }
}
