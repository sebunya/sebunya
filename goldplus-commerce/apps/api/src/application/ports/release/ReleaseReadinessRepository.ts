export interface ReleaseReadinessRun {
  id: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN';
  startedAt: string;
  completedAt?: string | null;
  triggeredBy: string;
}

export interface ReleaseReadinessGateResult {
  id: string;
  runId: string;
  gateId: string;
  category: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'NOT_CONFIGURED' | 'NOT_APPLICABLE' | 'BLOCKED' | 'UNKNOWN';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  evidence: Record<string, any>;
  source: string;
  recommendation?: string | null;
  safeReferenceId?: string | null;
  checkedAt: string;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  acknowledgementReason?: string | null;
}

export interface ReleaseDecision {
  id: string;
  runId: string;
  status: 'DRAFT' | 'READY_FOR_REVIEW' | 'APPROVED_FOR_CONTROLLED_ACTIVATION' | 'BLOCKED' | 'NEEDS_FIXES' | 'NOT_READY';
  recordedBy: string;
  notes?: string | null;
  createdAt: string;
}

export interface ReleaseReadinessSummary {
  latestRun: ReleaseReadinessRun | null;
  gates: ReleaseReadinessGateResult[];
  decision: ReleaseDecision | null;
}

export interface IReleaseReadinessRepository {
  createReadinessRun(runId: string, triggeredBy: string): Promise<ReleaseReadinessRun>;
  updateReadinessRun(runId: string, status: string): Promise<void>;
  saveGateResults(results: ReleaseReadinessGateResult[]): Promise<void>;
  getLatestReadinessRun(): Promise<ReleaseReadinessRun | null>;
  getReadinessRunById(runId: string): Promise<ReleaseReadinessRun | null>;
  listReadinessRuns(limit: number, offset: number): Promise<ReleaseReadinessRun[]>;
  getGateResultsForRun(runId: string): Promise<ReleaseReadinessGateResult[]>;
  getReleaseDecisionSummary(runId: string): Promise<ReleaseDecision | null>;
  recordReleaseDecision(runId: string, status: string, recordedBy: string, notes?: string): Promise<ReleaseDecision>;
  acknowledgeGate(gateId: string, runId: string, acknowledgedBy: string, reason: string): Promise<void>;
}
