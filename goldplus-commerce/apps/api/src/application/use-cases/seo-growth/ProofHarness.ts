/**
 * A fail-closed proof harness.
 *
 * This exists because of a specific incident: a proof run printed
 * DUPLICATE_OPPORTUNITIES=0 and a green summary when in fact nothing had been
 * written at all. Every counter was zero, so every check "passed". The zeros
 * were not evidence of correctness — they were evidence that the thing being
 * measured had never happened.
 *
 * The rule that prevents it: a stage may only report PASS if it EXECUTED and
 * at least one assertion actually RAN. A stage with zero executed assertions is
 * NOT_EXECUTED, and a suite containing one is never green. Absence of failure
 * is not presence of proof.
 */

export type StageResult = 'PASS' | 'FAIL' | 'NOT_EXECUTED' | 'INCONCLUSIVE';

export interface StageReport {
  name: string;
  executed: boolean;
  succeeded: boolean;
  assertionsPlanned: number;
  assertionsExecuted: number;
  assertionsPassed: number;
  assertionsFailed: number;
  result: StageResult;
  failures: string[];
  note?: string;
}

export interface HarnessReport {
  stages: StageReport[];
  totalPlanned: number;
  totalExecuted: number;
  totalPassed: number;
  totalFailed: number;
  /** Green only when every stage genuinely executed and passed. */
  green: boolean;
  exitCode: number;
  summary: string;
}

export class Stage {
  readonly failures: string[] = [];
  private planned = 0;
  private executed = 0;
  private passed = 0;
  private failed = 0;
  private started = false;
  private aborted: string | null = null;

  constructor(readonly name: string, plannedAssertions: number) {
    this.planned = plannedAssertions;
  }

  begin(): void { this.started = true; }

  /** Record that the stage could not run. INCONCLUSIVE, never PASS. */
  abort(reason: string): void { this.aborted = reason; }

  check(description: string, condition: boolean): boolean {
    this.started = true;
    this.executed += 1;
    if (condition) { this.passed += 1; return true; }
    this.failed += 1;
    this.failures.push(description);
    return false;
  }

  equals(description: string, actual: unknown, expected: unknown): boolean {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    return this.check(`${description} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, ok);
  }

  report(): StageReport {
    let result: StageResult;
    if (this.aborted) result = 'INCONCLUSIVE';
    // The false-green guard: nothing ran, so nothing is proven.
    else if (!this.started || this.executed === 0) result = 'NOT_EXECUTED';
    else if (this.failed > 0) result = 'FAIL';
    // Planned-but-skipped assertions mean partial coverage, not success.
    else if (this.executed < this.planned) result = 'INCONCLUSIVE';
    else result = 'PASS';

    return {
      name: this.name,
      executed: this.started,
      succeeded: result === 'PASS',
      assertionsPlanned: this.planned,
      assertionsExecuted: this.executed,
      assertionsPassed: this.passed,
      assertionsFailed: this.failed,
      result,
      failures: this.failures,
      note: this.aborted ?? (result === 'NOT_EXECUTED'
        ? 'No assertion executed. A stage that never ran cannot pass, whatever its counters say.'
        : result === 'INCONCLUSIVE'
          ? `Only ${this.executed} of ${this.planned} planned assertions ran.`
          : undefined),
    };
  }
}

export function summarise(stages: Stage[]): HarnessReport {
  const reports = stages.map((s) => s.report());
  const totalPlanned = reports.reduce((n, r) => n + r.assertionsPlanned, 0);
  const totalExecuted = reports.reduce((n, r) => n + r.assertionsExecuted, 0);
  const totalPassed = reports.reduce((n, r) => n + r.assertionsPassed, 0);
  const totalFailed = reports.reduce((n, r) => n + r.assertionsFailed, 0);

  const bad = reports.filter((r) => r.result !== 'PASS');
  const green = reports.length > 0 && bad.length === 0 && totalExecuted > 0;

  return {
    stages: reports, totalPlanned, totalExecuted, totalPassed, totalFailed,
    green,
    exitCode: green ? 0 : 1,
    summary: green
      ? `All ${reports.length} stages executed and passed (${totalPassed}/${totalPlanned} assertions).`
      : `NOT GREEN — ${bad.length} of ${reports.length} stage(s) did not pass: ${bad.map((b) => `${b.name}=${b.result}`).join(', ')}.`,
  };
}

/** Render a report as lines. A failed suite never ends on a green line. */
export function renderReport(report: HarnessReport): string[] {
  const lines = report.stages.map((s) =>
    `${s.name}: EXECUTED=${s.executed} ASSERTIONS_PLANNED=${s.assertionsPlanned} ` +
    `ASSERTIONS_EXECUTED=${s.assertionsExecuted} ASSERTIONS_PASSED=${s.assertionsPassed} ` +
    `ASSERTIONS_FAILED=${s.assertionsFailed} RESULT=${s.result}` +
    (s.note ? ` NOTE=${s.note}` : '') +
    (s.failures.length ? `\n    ${s.failures.join('\n    ')}` : ''),
  );
  lines.push(`HARNESS_GREEN=${report.green}`);
  lines.push(`EXIT_CODE=${report.exitCode}`);
  lines.push(report.summary);
  return lines;
}
