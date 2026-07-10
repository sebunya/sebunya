export type ActivationGateStatus =
  | 'PASS'
  | 'FAIL'
  | 'WARN'
  | 'BLOCKED'
  | 'NOT_CONFIGURED'
  | 'NOT_APPLICABLE'
  | 'DRY_RUN'
  | 'CONSENT_BLOCKED'
  | 'UNKNOWN';

export interface ActivationGate {
  gateId: string;
  activationRequestId: string;
  category: string;
  name: string;
  status: ActivationGateStatus;
  severity: string;
  evidenceSummary: string;
  safeReferenceId: string | null;
  checkedAt: Date;
  blockerReason: string | null;
  recommendation: string | null;
}

export interface ControlledActivationReadinessChecker {
  runChecks(activationRequestId: string): Promise<ActivationGate[]>;
  getLatestGates(activationRequestId: string): Promise<ActivationGate[]>;
  saveGates(gates: ActivationGate[]): Promise<void>;
  acknowledgeBlocker(activationRequestId: string, gateId: string, reason: string): Promise<void>;
}
