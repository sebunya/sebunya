import { InternalEmailDiagnosticCanaryGuard } from '../application/services/consent/InternalEmailDiagnosticCanaryGuard';
import { runRunnerIntegrityPreflight, type RunnerIntegrityResult } from '../application/services/consent/EmailDiagnosticRunnerIntegrity';
import { ZeptoInternalConsentCanaryTransport } from '../infrastructure/consent/ZeptoInternalConsentCanaryTransport';

export function createEmailDiagnosticRunner(): Readonly<{
  guard: InternalEmailDiagnosticCanaryGuard;
  transport: ZeptoInternalConsentCanaryTransport;
  integrity: RunnerIntegrityResult;
}> {
  const guard = new InternalEmailDiagnosticCanaryGuard();
  const transport = new ZeptoInternalConsentCanaryTransport();
  const integrity = runRunnerIntegrityPreflight({
    authorization_imports: ['../application/services/consent/InternalConsentCanaryGuard'],
    canary_guard_imports: ['../application/services/consent/InternalEmailDiagnosticCanaryGuard'],
    diagnostic_transport_imports: ['../infrastructure/consent/ZeptoInternalConsentCanaryTransport'],
    feature_gate_reader_imports: ['../application/services/consent/ConsentFeatureGates'],
    repository_imports: ['../infrastructure/consent/DrizzleConsentOperatingRepository'],
  });
  return Object.freeze({ guard, transport, integrity });
}
