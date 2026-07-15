import { createHash } from 'node:crypto';

export const INTERNAL_CANARY_PROVIDERS = ['transactional_email', 'whatsapp', 'sms'] as const;
export const READINESS_ONLY_PROVIDERS = [
  'meta_capi',
  'tiktok_events',
  'google_ads',
  'linkedin',
  'x',
  'pinterest',
  'snapchat',
  'posthog',
] as const;
export const PROVIDER_READINESS_IDS = [...INTERNAL_CANARY_PROVIDERS, ...READINESS_ONLY_PROVIDERS] as const;

export type InternalCanaryProvider = (typeof INTERNAL_CANARY_PROVIDERS)[number];
export type ProviderReadinessId = (typeof PROVIDER_READINESS_IDS)[number];
export type InternalRecipientClassification =
  | 'robert_owned_internal_test'
  | 'company_owned_internal_test'
  | 'provider_sandbox'
  | 'customer'
  | 'prospect'
  | 'checkout_contact'
  | 'order_contact'
  | 'support_contact'
  | 'legacy_preference_contact'
  | 'unknown';

export interface ProviderReadinessChecks {
  credential_present: boolean;
  host_or_base_url_present: boolean;
  sender_or_business_identity_present: boolean;
  template_or_message_key_present: boolean;
  internal_canary_recipient_present: boolean;
  live_send_gate_default_disabled: boolean;
  internal_canary_guard_present: boolean;
  suppression_table_available: boolean;
  audit_event_table_available: boolean;
  copy_template_version_available: boolean;
  eligibility_evaluator_available: boolean;
  rate_limit_one_available: boolean;
  rollback_gate_available: boolean;
  transport_implemented: boolean;
}

export type ProviderReadinessClassification =
  | 'ready_for_internal_canary'
  | 'blocked_missing_credentials'
  | 'blocked_missing_template'
  | 'blocked_missing_sender'
  | 'blocked_missing_internal_recipient'
  | 'blocked_missing_canary_guard'
  | 'blocked_transport_not_implemented'
  | 'dry_run_only'
  | 'not_in_scope_for_live_canary';

export function classifyProviderReadiness(
  provider: ProviderReadinessId,
  checks: Readonly<ProviderReadinessChecks>,
): ProviderReadinessClassification {
  if (READINESS_ONLY_PROVIDERS.includes(provider as (typeof READINESS_ONLY_PROVIDERS)[number])) {
    return checks.eligibility_evaluator_available ? 'dry_run_only' : 'not_in_scope_for_live_canary';
  }
  if (!checks.transport_implemented) return 'blocked_transport_not_implemented';
  if (!checks.credential_present || !checks.host_or_base_url_present) return 'blocked_missing_credentials';
  if (!checks.sender_or_business_identity_present) return 'blocked_missing_sender';
  if (!checks.template_or_message_key_present || !checks.copy_template_version_available) {
    return 'blocked_missing_template';
  }
  if (!checks.internal_canary_recipient_present) return 'blocked_missing_internal_recipient';
  if (
    !checks.internal_canary_guard_present ||
    !checks.live_send_gate_default_disabled ||
    !checks.suppression_table_available ||
    !checks.audit_event_table_available ||
    !checks.eligibility_evaluator_available ||
    !checks.rate_limit_one_available ||
    !checks.rollback_gate_available
  ) return 'blocked_missing_canary_guard';
  return 'ready_for_internal_canary';
}

export interface InternalCanaryAuthorizationInput {
  internal_canary: boolean;
  provider: InternalCanaryProvider;
  recipient: string;
  recipient_classification: InternalRecipientClassification;
  recipient_allowlisted: boolean;
  recipient_count: number;
  correlation_id: string;
  audit_event_recorded: boolean;
  eligibility_passed: boolean;
  suppression_check_passed: boolean;
  withdrawal_check_passed: boolean;
  policy_block_check_passed: boolean;
  copy_template_version_present: boolean;
  provider_credential_present: boolean;
  provider_specific_canary_mode: boolean;
  broad_live_send_gate_enabled: boolean;
  campaign_id: string | null;
  newsletter_id: string | null;
}

export type InternalCanaryGuardResult =
  | { ok: true; authorization: InternalCanaryAuthorization }
  | { ok: false; reasons: string[] };

export interface InternalCanaryAuthorization {
  readonly provider: InternalCanaryProvider;
  readonly recipient_fingerprint: string;
  readonly correlation_id: string;
  readonly issued_at: string;
}

const activeAuthorizations = new WeakSet<object>();
const allowedRecipientClassifications = new Set<InternalRecipientClassification>([
  'robert_owned_internal_test',
  'company_owned_internal_test',
  'provider_sandbox',
]);

export function fingerprintInternalCanaryRecipient(recipient: string): string {
  return createHash('sha256').update(recipient.trim().toLowerCase(), 'utf8').digest('hex');
}

export function consumeInternalCanaryAuthorization(
  authorization: InternalCanaryAuthorization,
): InternalCanaryAuthorization {
  if (!activeAuthorizations.has(authorization as object)) throw new Error('invalid_or_consumed_internal_canary_authorization');
  activeAuthorizations.delete(authorization as object);
  return authorization;
}

export class InternalConsentCanaryGuard {
  private readonly attempts = new Map<InternalCanaryProvider, number>();
  private locked = false;

  authorize(input: Readonly<InternalCanaryAuthorizationInput>): InternalCanaryGuardResult {
    const reasons: string[] = [];
    if (this.locked) reasons.push('internal_canary_gate_locked');
    if (!input.internal_canary) reasons.push('internal_canary_true_required');
    if (!INTERNAL_CANARY_PROVIDERS.includes(input.provider)) reasons.push('provider_not_allowed');
    if (!input.recipient.trim()) reasons.push('recipient_required');
    if (!allowedRecipientClassifications.has(input.recipient_classification)) reasons.push('internal_recipient_classification_required');
    if (!input.recipient_allowlisted) reasons.push('internal_recipient_allowlist_required');
    if (input.recipient_count !== 1) reasons.push('exactly_one_recipient_required');
    if (!input.correlation_id.trim()) reasons.push('correlation_id_required');
    if (!input.audit_event_recorded) reasons.push('audit_event_required_before_canary');
    if (!input.eligibility_passed) reasons.push('eligibility_required_before_canary');
    if (!input.suppression_check_passed) reasons.push('suppression_blocks_canary');
    if (!input.withdrawal_check_passed) reasons.push('withdrawal_blocks_canary');
    if (!input.policy_block_check_passed) reasons.push('policy_block_blocks_canary');
    if (!input.copy_template_version_present) reasons.push('copy_template_version_required');
    if (!input.provider_credential_present) reasons.push('provider_credential_required');
    if (!input.provider_specific_canary_mode) reasons.push('provider_specific_canary_mode_required');
    if (input.broad_live_send_gate_enabled) reasons.push('broad_live_send_gate_must_remain_disabled');
    if (input.campaign_id) reasons.push('campaign_not_allowed');
    if (input.newsletter_id) reasons.push('newsletter_not_allowed');
    if ((this.attempts.get(input.provider) ?? 0) >= 1) reasons.push('max_one_canary_per_provider_per_run');
    if (reasons.length > 0) return { ok: false, reasons: Object.freeze(reasons) as unknown as string[] };

    this.attempts.set(input.provider, 1);
    const authorization = Object.freeze({
      provider: input.provider,
      recipient_fingerprint: fingerprintInternalCanaryRecipient(input.recipient),
      correlation_id: input.correlation_id,
      issued_at: new Date().toISOString(),
    });
    activeAuthorizations.add(authorization);
    return { ok: true, authorization };
  }

  attemptCount(provider: InternalCanaryProvider): number {
    return this.attempts.get(provider) ?? 0;
  }

  lockDown(): void {
    this.locked = true;
  }

  isLockedDown(): boolean {
    return this.locked;
  }
}
