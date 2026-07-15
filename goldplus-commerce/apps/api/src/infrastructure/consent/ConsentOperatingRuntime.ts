import {
  ApplyPolicyBlock,
  PreviewProviderEligibility,
  RecordConsentGrant,
  RecordConsentWithdrawal,
  RecordLegacyMappingResult,
  RecordProviderStopSignal,
  RecordProviderUnsubscribeSignal,
  RecordSupportAssistedPreferenceRequest,
  RequestPreferenceChange,
  ResolveConsentConflict,
  SupersedeConsentState,
  VerifyPreferenceChange,
} from '../../application/use-cases/consent/ConsentOperatingCommands';
import { readConsentFeatureGates } from '../../application/services/consent/ConsentFeatureGates';
import { ConsentNoSendReleaseReadiness } from '../../application/services/consent/ConsentNoSendReleaseReadiness';
import { LegacyPreferenceMigrationDryRun } from '../../application/services/consent/LegacyPreferenceMigrationDryRun';
import { DrizzleConsentOperatingRepository } from './DrizzleConsentOperatingRepository';

export function createConsentOperatingRuntime(source: Readonly<Record<string, string | undefined>> = process.env) {
  const gates = readConsentFeatureGates(source);
  const repository = new DrizzleConsentOperatingRepository();
  return Object.freeze({
    gates,
    repository,
    requestPreferenceChange: new RequestPreferenceChange(repository, gates),
    verifyPreferenceChange: new VerifyPreferenceChange(repository, gates),
    recordConsentGrant: new RecordConsentGrant(repository, gates),
    recordConsentWithdrawal: new RecordConsentWithdrawal(repository, gates),
    recordProviderStopSignal: new RecordProviderStopSignal(repository, gates),
    recordProviderUnsubscribeSignal: new RecordProviderUnsubscribeSignal(repository, gates),
    applyPolicyBlock: new ApplyPolicyBlock(repository, gates),
    supersedeConsentState: new SupersedeConsentState(repository, gates),
    recordSupportAssistedPreferenceRequest: new RecordSupportAssistedPreferenceRequest(repository, gates),
    resolveConsentConflict: new ResolveConsentConflict(repository, gates),
    previewProviderEligibility: new PreviewProviderEligibility(repository, gates),
    recordLegacyMappingResult: new RecordLegacyMappingResult(repository, gates),
    legacyMigrationDryRun: new LegacyPreferenceMigrationDryRun(),
    noSendReleaseReadiness: new ConsentNoSendReleaseReadiness(),
  });
}

let runtime: ReturnType<typeof createConsentOperatingRuntime> | null = null;

export function getConsentOperatingRuntime(): ReturnType<typeof createConsentOperatingRuntime> {
  runtime ??= createConsentOperatingRuntime();
  return runtime;
}
