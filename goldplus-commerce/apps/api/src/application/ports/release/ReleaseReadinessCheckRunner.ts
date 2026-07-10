import { ReleaseReadinessGateResult } from './ReleaseReadinessRepository';

export interface CheckRunnerResult {
  status: 'PASS' | 'FAIL' | 'WARN' | 'NOT_CONFIGURED' | 'NOT_APPLICABLE' | 'BLOCKED' | 'UNKNOWN';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  evidence: Record<string, any>;
  recommendation?: string;
  source: string;
}

export interface IReleaseReadinessCheckRunner {
  runCheck(gateId: string): Promise<CheckRunnerResult>;
  runCategory(category: string): Promise<Record<string, CheckRunnerResult>>;
  runAll(): Promise<Record<string, CheckRunnerResult>>;
  getSupportedChecks(): string[];
}
