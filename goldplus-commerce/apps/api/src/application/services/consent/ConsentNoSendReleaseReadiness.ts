import type { ConsentFeatureGates } from './ConsentFeatureGates';

export interface ConsentNoSendReadiness {
  commands_enabled: boolean;
  preference_centre_save_enabled: boolean;
  admin_workflow_enabled: boolean;
  support_workflow_enabled: boolean;
  provider_suppression_intake_enabled: boolean;
  provider_dry_run_enabled: boolean;
  provider_live_sends_enabled: boolean;
  legacy_migration_dry_run_enabled: boolean;
  production_migration_required: true;
  specialist_approvals_pending: true;
  no_send_status: 'pass' | 'fail';
  dry_run_readiness: 'disabled' | 'available';
  live_send_readiness: 'blocked';
  reasons: string[];
}

export class ConsentNoSendReleaseReadiness {
  evaluate(gates: ConsentFeatureGates): ConsentNoSendReadiness {
    const liveSendsEnabled = gates.CONSENT_PROVIDER_LIVE_SENDS_ENABLED;
    return Object.freeze({
      commands_enabled: gates.CONSENT_PERSISTENCE_COMMANDS_ENABLED,
      preference_centre_save_enabled: gates.CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED,
      admin_workflow_enabled: gates.CONSENT_ADMIN_WORKFLOW_ENABLED,
      support_workflow_enabled: gates.CONSENT_SUPPORT_WORKFLOW_ENABLED,
      provider_suppression_intake_enabled: gates.CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED,
      provider_dry_run_enabled: gates.CONSENT_PROVIDER_DRY_RUN_ENABLED,
      provider_live_sends_enabled: liveSendsEnabled,
      legacy_migration_dry_run_enabled: gates.CONSENT_LEGACY_MIGRATION_DRY_RUN_ENABLED,
      production_migration_required: true,
      specialist_approvals_pending: true,
      no_send_status: liveSendsEnabled ? 'fail' : 'pass',
      dry_run_readiness: gates.CONSENT_PROVIDER_DRY_RUN_ENABLED ? 'available' : 'disabled',
      live_send_readiness: 'blocked',
      reasons: Object.freeze([
        ...(liveSendsEnabled ? ['provider_live_sends_flag_is_unsafe_without_future_authorization'] : []),
        'this_layer_contains_no_provider_transport',
        'production_migration_not_executed',
        'specialist_approvals_pending',
      ]) as unknown as string[],
    });
  }
}
