import {
  assertLegacyMappingIsNotAutoGrant,
  assertNoAnonymousConsentGrant,
  assertNoCheckoutContactMarketingGrant,
  assertPolicyBlockPrecedence,
  assertProviderSuppressionShape,
  assertWithdrawalSupersedesGrant,
  type ConsentState,
} from '../../../domain/consent/ConsentFoundation';
import { evaluateConsentProviderEligibilityPreview } from '../../../domain/consent/ConsentProviderEligibilityPreview';
import type {
  ConsentAggregateKey,
  ConsentEventWrite,
  ConsentMutationReceipt,
  ConsentOperatingRepository,
  ProviderUnsubscribeWrite,
  SupportAssistedRequestWrite,
} from '../../ports/consent/ConsentOperatingRepository';
import {
  consentEventIdFor,
  requireConsentMutationContext,
  requirePurposeChannel,
  requireValue,
  type ConsentCommandContext,
} from '../../services/consent/ConsentCommandSupport';
import {
  isConsentFeatureEnabled,
  type ConsentFeatureGateName,
  type ConsentFeatureGates,
} from '../../services/consent/ConsentFeatureGates';

export type ConsentCommandResult =
  | { ok: true; status: 'persisted' | 'recorded' | 'preview'; receipt?: ConsentMutationReceipt; data?: unknown }
  | { ok: false; status: 'disabled' | 'rejected'; reasons: string[] };

export interface StateMutationInput extends ConsentAggregateKey, ConsentCommandContext {
  source_surface: string;
  copy_version_id: string | null;
  effective_at?: string;
  provider_callback_ref?: string | null;
  support_ticket_ref?: string | null;
}

function disabled(gate: ConsentFeatureGateName): ConsentCommandResult {
  return { ok: false, status: 'disabled', reasons: [`${gate.toLowerCase()}_is_disabled`] };
}

function rejected(error: unknown): ConsentCommandResult {
  return { ok: false, status: 'rejected', reasons: [error instanceof Error ? error.message : 'consent_command_rejected'] };
}

function validateBase(input: StateMutationInput): void {
  requireConsentMutationContext(input);
  requirePurposeChannel(input.purpose_key, input.channel_key);
  requireValue(input.customer_identity_ref, 'customer_identity_ref');
  requireValue(input.endpoint_ref, 'endpoint_ref');
  requireValue(input.source_surface, 'source_surface');
  if (input.copy_version_id !== null) requireValue(input.copy_version_id, 'copy_version_id');
}

function buildEvent(
  commandName: string,
  input: StateMutationInput,
  eventType: string,
  previousState: ConsentState | null,
  newState: ConsentState,
): ConsentEventWrite {
  return {
    ...input,
    consent_event_id: consentEventIdFor(input.idempotency_key, commandName),
    event_type: eventType,
    state: newState,
    previous_state: previousState,
    new_state: newState,
    identity_level: input.identity_level,
    provider_callback_ref: input.provider_callback_ref ?? null,
    support_ticket_ref: input.support_ticket_ref ?? null,
    retention_policy: 'consent-audit-v1',
    effective_at: input.effective_at ?? new Date().toISOString(),
  };
}

abstract class GatedConsentCommand {
  constructor(
    protected readonly repository: ConsentOperatingRepository,
    protected readonly gates: ConsentFeatureGates,
  ) {}

  protected enabled(gate: ConsentFeatureGateName): boolean {
    return isConsentFeatureEnabled(this.gates, gate);
  }

  protected async current(input: ConsentAggregateKey): Promise<ConsentState | null> {
    return (await this.repository.getLatestConsentState(input))?.state ?? null;
  }
}

export class RequestPreferenceChange extends GatedConsentCommand {
  async execute(input: StateMutationInput): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_PERSISTENCE_COMMANDS_ENABLED')) return disabled('CONSENT_PERSISTENCE_COMMANDS_ENABLED');
    try {
      validateBase(input);
      const previous = await this.current(input);
      if (previous === 'blocked_by_policy') throw new Error('policy_block_outranks_preference_request');
      if (previous === 'withdrawn') throw new Error('new_verified_flow_required_after_withdrawal');
      const next = input.actor_type === 'support_operator' ? 'requested_support_assisted' : 'pending_verification';
      const receipt = await this.repository.commitStateChange(
        buildEvent('RequestPreferenceChange', input, 'preference_change_requested', previous, next),
      );
      return { ok: true, status: 'persisted', receipt };
    } catch (error) {
      return rejected(error);
    }
  }
}

export class VerifyPreferenceChange extends GatedConsentCommand {
  async execute(input: StateMutationInput & { verification_passed: boolean }): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_PERSISTENCE_COMMANDS_ENABLED')) return disabled('CONSENT_PERSISTENCE_COMMANDS_ENABLED');
    try {
      validateBase(input);
      if (!input.verification_passed) throw new Error('verification_failed');
      if (input.identity_level === 'anonymous' || input.identity_level === 'checkout_contact_only') {
        throw new Error('verified_identity_required');
      }
      const previous = await this.current(input);
      const receipt = await this.repository.commitStateChange(
        buildEvent('VerifyPreferenceChange', input, 'preference_change_verified', previous, 'pending_verification'),
      );
      return { ok: true, status: 'persisted', receipt, data: { verified: true, grant_recorded: false } };
    } catch (error) {
      return rejected(error);
    }
  }
}

export class RecordConsentGrant extends GatedConsentCommand {
  async execute(input: StateMutationInput & { optional_marketing: boolean }): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_PERSISTENCE_COMMANDS_ENABLED')) return disabled('CONSENT_PERSISTENCE_COMMANDS_ENABLED');
    try {
      validateBase(input);
      assertNoAnonymousConsentGrant(input.identity_level, 'granted');
      assertNoCheckoutContactMarketingGrant(input.identity_level, input.optional_marketing, 'granted');
      if (input.actor_type === 'support_operator' && input.purpose_key === 'marketing_offers_campaigns') {
        throw new Error('support_conversation_cannot_grant_campaign_consent');
      }
      if (input.source_surface.includes('measurement')) throw new Error('measurement_consent_is_not_messaging_consent');
      if (input.purpose_key === 'memory_lane_annual_journey' && input.source_surface.includes('loyalty')) {
        throw new Error('loyalty_interest_is_not_memory_lane_consent');
      }
      if (input.purpose_key === 'utilisation_aware_offers' && input.source_surface.includes('memory_lane')) {
        throw new Error('memory_lane_consent_is_not_utilisation_aware_offer_consent');
      }
      requireValue(input.copy_version_id, 'copy_version_id');
      const previous = await this.current(input);
      if (previous === 'blocked_by_policy') throw new Error('policy_block_outranks_grant');
      if (previous === 'withdrawn') throw new Error('new_verified_flow_required_after_withdrawal');
      const receipt = await this.repository.commitStateChange(
        buildEvent('RecordConsentGrant', input, 'consent_grant_recorded', previous, 'granted'),
      );
      return { ok: true, status: 'persisted', receipt };
    } catch (error) {
      return rejected(error);
    }
  }
}

export class RecordConsentWithdrawal extends GatedConsentCommand {
  async execute(input: StateMutationInput): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_PERSISTENCE_COMMANDS_ENABLED')) return disabled('CONSENT_PERSISTENCE_COMMANDS_ENABLED');
    try {
      validateBase(input);
      const previous = await this.current(input);
      const next = assertWithdrawalSupersedesGrant(true, previous ?? 'unknown');
      const receipt = await this.repository.commitStateChange(
        buildEvent('RecordConsentWithdrawal', input, 'consent_withdrawal_recorded', previous, next === 'unknown' ? 'withdrawn' : next),
      );
      return { ok: true, status: 'persisted', receipt };
    } catch (error) {
      return rejected(error);
    }
  }
}

abstract class ProviderSuppressionCommand extends GatedConsentCommand {
  protected async record(input: ProviderUnsubscribeWrite, eventType: 'stop' | 'unsubscribe'): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED')) {
      return disabled('CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED');
    }
    try {
      requireConsentMutationContext({
        actor_type: 'provider_callback',
        actor_id: input.provider_key,
        identity_level: 'provider_callback_verified',
        correlation_id: input.correlation_id,
        idempotency_key: input.idempotency_key,
        reason: input.reason,
      });
      requirePurposeChannel(input.purpose_key ?? 'marketing_offers_campaigns', input.channel_key);
      if (!input.authenticity_verified) throw new Error('provider_callback_authenticity_required');
      if (!input.freshness_verified) throw new Error('provider_callback_freshness_required');
      requireValue(input.provider_key, 'provider_key');
      requireValue(input.provider_event_ref, 'provider_event_ref');
      requireValue(input.provider_callback_ref, 'provider_callback_ref');
      assertProviderSuppressionShape({
        channel_key: input.channel_key,
        suppression_active: true,
        provider_stop_or_unsubscribe: true,
      });
      const providerEvent = await this.repository.recordProviderUnsubscribeEvent(input);
      const suppression = await this.repository.recordChannelSuppression(input);
      return { ok: true, status: 'recorded', data: { event_type: eventType, ...providerEvent, ...suppression } };
    } catch (error) {
      return rejected(error);
    }
  }
}

export class RecordProviderStopSignal extends ProviderSuppressionCommand {
  execute(input: ProviderUnsubscribeWrite): Promise<ConsentCommandResult> {
    return this.record(input, 'stop');
  }
}

export class RecordProviderUnsubscribeSignal extends ProviderSuppressionCommand {
  execute(input: ProviderUnsubscribeWrite): Promise<ConsentCommandResult> {
    return this.record(input, 'unsubscribe');
  }
}

export class ApplyPolicyBlock extends GatedConsentCommand {
  async execute(input: StateMutationInput & { policy_version: string; cohort_ref?: string | null }): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_ADMIN_WORKFLOW_ENABLED')) return disabled('CONSENT_ADMIN_WORKFLOW_ENABLED');
    try {
      validateBase(input);
      if (input.actor_type !== 'admin') throw new Error('admin_actor_required');
      requireValue(input.policy_version, 'policy_version');
      const block = await this.repository.recordPolicyBlock({
        customer_identity_ref: input.customer_identity_ref,
        cohort_ref: input.cohort_ref ?? null,
        purpose_key: input.purpose_key,
        channel_key: input.channel_key,
        policy_block_reason: input.reason,
        policy_version: input.policy_version,
        actor_type: input.actor_type,
        actor_id: input.actor_id,
        correlation_id: input.correlation_id,
        idempotency_key: input.idempotency_key,
        effective_at: input.effective_at ?? new Date().toISOString(),
        expires_at: null,
      });
      const previous = await this.current(input);
      const state = assertPolicyBlockPrecedence(true, previous ?? 'unknown');
      const receipt = await this.repository.commitStateChange(
        buildEvent('ApplyPolicyBlock', input, 'policy_block_applied', previous, state),
      );
      return { ok: true, status: 'persisted', receipt, data: block };
    } catch (error) {
      return rejected(error);
    }
  }
}

export class SupersedeConsentState extends GatedConsentCommand {
  async execute(input: StateMutationInput & { proposed_state: ConsentState }): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_ADMIN_WORKFLOW_ENABLED')) return disabled('CONSENT_ADMIN_WORKFLOW_ENABLED');
    try {
      validateBase(input);
      if (input.actor_type !== 'admin') throw new Error('admin_actor_required');
      if (!['unknown', 'not_requested', 'requested_support_assisted', 'pending_verification', 'withdrawn', 'expired', 'superseded', 'blocked_by_policy', 'service_only'].includes(input.proposed_state)) {
        throw new Error('invalid_manual_correction_state');
      }
      if (input.proposed_state === 'granted') throw new Error('manual_override_cannot_create_grant');
      const previous = await this.current(input);
      const receipt = await this.repository.commitStateChange(
        buildEvent('SupersedeConsentState', input, 'consent_state_superseded', previous, input.proposed_state),
      );
      return { ok: true, status: 'persisted', receipt };
    } catch (error) {
      return rejected(error);
    }
  }
}

export class RecordSupportAssistedPreferenceRequest extends GatedConsentCommand {
  async execute(input: SupportAssistedRequestWrite): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_SUPPORT_WORKFLOW_ENABLED')) return disabled('CONSENT_SUPPORT_WORKFLOW_ENABLED');
    try {
      requireConsentMutationContext({
        actor_type: input.actor_type,
        actor_id: input.actor_id,
        identity_level: input.identity_level,
        correlation_id: input.correlation_id,
        idempotency_key: input.idempotency_key,
        reason: 'support-assisted preference request',
      });
      requirePurposeChannel(input.purpose_key, input.channel_key);
      if (input.actor_type !== 'support_operator') throw new Error('support_operator_required');
      if (input.requested_state === 'granted') throw new Error('support_request_cannot_directly_grant');
      requireValue(input.support_ticket_ref, 'support_ticket_ref');
      requireValue(input.script_copy_version_id, 'script_copy_version_id');
      requireValue(input.expires_at, 'expires_at');
      const result = await this.repository.recordSupportAssistedRequest(input);
      const previous = await this.repository.getLatestConsentState(input);
      const receipt = await this.repository.commitStateChange(buildEvent(
        'RecordSupportAssistedPreferenceRequest',
        {
          ...input,
          reason: 'support-assisted preference request recorded',
          source_surface: 'support_assisted_workflow',
          copy_version_id: input.script_copy_version_id,
          support_ticket_ref: input.support_ticket_ref,
        },
        'support_assisted_request_recorded',
        previous?.state ?? null,
        'requested_support_assisted',
      ));
      return { ok: true, status: 'recorded', receipt, data: result };
    } catch (error) {
      return rejected(error);
    }
  }
}

export class ResolveConsentConflict extends GatedConsentCommand {
  async execute(input: StateMutationInput & { competing_states: ConsentState[] }): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_ADMIN_WORKFLOW_ENABLED')) return disabled('CONSENT_ADMIN_WORKFLOW_ENABLED');
    try {
      validateBase(input);
      if (input.actor_type !== 'admin') throw new Error('admin_actor_required');
      const resolution: ConsentState = input.competing_states.includes('blocked_by_policy')
        ? 'blocked_by_policy'
        : input.competing_states.includes('withdrawn')
          ? 'withdrawn'
          : 'unknown';
      const previous = await this.current(input);
      const receipt = await this.repository.commitStateChange(
        buildEvent('ResolveConsentConflict', input, 'consent_conflict_resolved', previous, resolution),
      );
      return { ok: true, status: 'persisted', receipt, data: { resolution } };
    } catch (error) {
      return rejected(error);
    }
  }
}

export class PreviewProviderEligibility extends GatedConsentCommand {
  async execute(input: ConsentAggregateKey): Promise<ConsentCommandResult> {
    if (!this.enabled('CONSENT_PROVIDER_DRY_RUN_ENABLED')) return disabled('CONSENT_PROVIDER_DRY_RUN_ENABLED');
    try {
      requirePurposeChannel(input.purpose_key, input.channel_key);
      requireValue(input.customer_identity_ref, 'customer_identity_ref');
      requireValue(input.endpoint_ref, 'endpoint_ref');
      const previewInput = await this.repository.buildDryRunEligibilityInput(input);
      const preview = evaluateConsentProviderEligibilityPreview(previewInput);
      return { ok: true, status: 'preview', data: preview };
    } catch (error) {
      return rejected(error);
    }
  }
}

export class RecordLegacyMappingResult {
  constructor(
    private readonly repository: ConsentOperatingRepository,
    private readonly gates: ConsentFeatureGates,
  ) {}

  async execute(input: Parameters<ConsentOperatingRepository['recordLegacyMappingResult']>[0]): Promise<ConsentCommandResult> {
    if (!isConsentFeatureEnabled(this.gates, 'CONSENT_LEGACY_MIGRATION_DRY_RUN_ENABLED')) {
      return disabled('CONSENT_LEGACY_MIGRATION_DRY_RUN_ENABLED');
    }
    try {
      requireValue(input.correlation_id, 'correlation_id');
      requireValue(input.idempotency_key, 'idempotency_key');
      assertLegacyMappingIsNotAutoGrant(input.mapping_outcome as ConsentState);
      return { ok: true, status: 'recorded', data: await this.repository.recordLegacyMappingResult(input) };
    } catch (error) {
      return rejected(error);
    }
  }
}
