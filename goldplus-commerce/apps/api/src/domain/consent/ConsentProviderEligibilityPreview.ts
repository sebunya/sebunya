import type { ConsentIdentityLevel, ConsentState } from './ConsentFoundation';

export interface ConsentProviderEligibilityPreviewInput {
  purpose_key: string;
  channel_key: string;
  consent_state: ConsentState;
  identity_level: ConsentIdentityLevel;
  optional_marketing: boolean;
  policy_block_active: boolean;
  withdrawal_active: boolean;
  provider_suppression_active: boolean;
  template_required: boolean;
  template_approved: boolean;
  copy_version_present: boolean;
  provider_credential_configured: boolean;
  provider_delivery_enabled: boolean;
  message_category_matches_purpose: boolean;
}

export interface ConsentProviderEligibilityPreview {
  eligible: boolean;
  reasons: string[];
  missing_gates: string[];
  suppression_status: 'active' | 'none';
  state_used: ConsentState;
  audit_preview_required: true;
  delivery_mode: 'disabled' | 'dry_run_only' | 'future_live_allowed_after_approval';
}

export function evaluateConsentProviderEligibilityPreview(
  input: ConsentProviderEligibilityPreviewInput,
): ConsentProviderEligibilityPreview {
  const reasons: string[] = [];
  const missingGates: string[] = [];
  const fail = (reason: string, gate?: string): void => {
    reasons.push(reason);
    if (gate) missingGates.push(gate);
  };

  if (input.purpose_key.trim() === '') fail('purpose_missing', 'purpose_allowed');
  if (input.channel_key.trim() === '') fail('channel_missing', 'channel_allowed');
  if (input.policy_block_active) fail('policy_block_active');
  if (input.provider_suppression_active) fail('provider_suppression_active');
  if (input.withdrawal_active) fail('withdrawal_active');
  if (input.consent_state !== 'granted') fail(`consent_state_${input.consent_state}`, 'current_grant');
  if (input.identity_level === 'anonymous') fail('identity_anonymous', 'verified_identity');
  if (input.optional_marketing && input.identity_level === 'checkout_contact_only') {
    fail('checkout_contact_not_marketing_consent', 'verified_marketing_identity');
  }
  if (!input.copy_version_present) fail('copy_version_missing', 'copy_version');
  if (input.template_required && !input.template_approved) fail('template_not_approved', 'approved_template');
  if (!input.message_category_matches_purpose) fail('message_category_mismatch', 'purpose_category_match');
  if (!input.provider_credential_configured) fail('provider_credential_not_configured', 'provider_credential');
  if (!input.provider_delivery_enabled) fail('provider_delivery_disabled', 'provider_delivery_approval');

  const eligible = reasons.length === 0;
  return Object.freeze({
    eligible,
    reasons: Object.freeze([...reasons]) as unknown as string[],
    missing_gates: Object.freeze([...missingGates]) as unknown as string[],
    suppression_status: input.provider_suppression_active ? 'active' : 'none',
    state_used: input.consent_state,
    audit_preview_required: true,
    delivery_mode: !input.provider_delivery_enabled
      ? 'disabled'
      : eligible
        ? 'future_live_allowed_after_approval'
        : 'dry_run_only',
  });
}
