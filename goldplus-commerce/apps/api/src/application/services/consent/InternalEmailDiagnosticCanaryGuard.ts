import {
  InternalConsentCanaryGuard,
  fingerprintInternalCanaryRecipient,
  type InternalCanaryAuthorization,
  type InternalRecipientClassification,
} from './InternalConsentCanaryGuard';

export interface InternalEmailDiagnosticCanaryInput {
  transport_response_capture_implemented: boolean;
  internal_canary: boolean;
  provider: 'transactional_email';
  recipient: string;
  recipient_hash: string;
  recipient_classification: InternalRecipientClassification;
  recipient_allowlisted: boolean;
  recipient_count: number;
  correlation_id: string;
  max_attempts_for_run: number;
  audit_event_recorded: boolean;
  eligibility_passed: boolean;
  suppression_checked_and_clear: boolean;
  withdrawal_checked_and_clear: boolean;
  policy_checked_and_clear: boolean;
  copy_version_present: boolean;
  credential_present: boolean;
  sender_present: boolean;
  host_present: boolean;
  payload_valid: boolean;
  audit_event_table_available: boolean;
  provider_specific_diagnostic_mode: boolean;
  broad_live_send_gate_enabled: boolean;
  campaign_id: string | null;
  newsletter_id: string | null;
}

export type InternalEmailDiagnosticCanaryResult =
  | { ok: true; authorization: InternalCanaryAuthorization }
  | { ok: false; reasons: readonly string[] };

export class InternalEmailDiagnosticCanaryGuard {
  private readonly core = new InternalConsentCanaryGuard();

  authorize(input: Readonly<InternalEmailDiagnosticCanaryInput>): InternalEmailDiagnosticCanaryResult {
    const reasons: string[] = [];
    if (!input.transport_response_capture_implemented) reasons.push('diagnostic_response_capture_required');
    if (input.provider !== 'transactional_email') reasons.push('transactional_email_provider_required');
    if (input.recipient_hash !== fingerprintInternalCanaryRecipient(input.recipient)) {
      reasons.push('recipient_hash_binding_required');
    }
    if (input.max_attempts_for_run !== 1) reasons.push('max_diagnostic_attempts_must_equal_one');
    if (!input.sender_present) reasons.push('sender_identity_required');
    if (!input.host_present) reasons.push('provider_host_required');
    if (!input.payload_valid) reasons.push('diagnostic_payload_required');
    if (!input.audit_event_table_available) reasons.push('audit_event_table_required');
    if (reasons.length > 0) return { ok: false, reasons: Object.freeze(reasons) };

    const result = this.core.authorize({
      internal_canary: input.internal_canary,
      provider: input.provider,
      recipient: input.recipient,
      recipient_classification: input.recipient_classification,
      recipient_allowlisted: input.recipient_allowlisted,
      recipient_count: input.recipient_count,
      correlation_id: input.correlation_id,
      audit_event_recorded: input.audit_event_recorded,
      eligibility_passed: input.eligibility_passed,
      suppression_check_passed: input.suppression_checked_and_clear,
      withdrawal_check_passed: input.withdrawal_checked_and_clear,
      policy_block_check_passed: input.policy_checked_and_clear,
      copy_template_version_present: input.copy_version_present,
      provider_credential_present: input.credential_present,
      provider_specific_canary_mode: input.provider_specific_diagnostic_mode,
      broad_live_send_gate_enabled: input.broad_live_send_gate_enabled,
      campaign_id: input.campaign_id,
      newsletter_id: input.newsletter_id,
    });
    return result.ok ? result : { ok: false, reasons: Object.freeze(result.reasons) };
  }

  lockDown(): void {
    this.core.lockDown();
  }

  isLockedDown(): boolean {
    return this.core.isLockedDown();
  }

  attemptCount(): number {
    return this.core.attemptCount('transactional_email');
  }
}
