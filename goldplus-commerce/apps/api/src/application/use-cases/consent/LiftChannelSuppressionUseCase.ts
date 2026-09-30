import type { ConsentOperatingRepository } from '../../ports/consent/ConsentOperatingRepository';
import { isConsentFeatureEnabled, type ConsentFeatureGates } from '../../services/consent/ConsentFeatureGates';

export const LIFT_REASON_MIN = 5;
export const LIFT_REASON_MAX = 500;
const SUPPRESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LiftSuppressionAuditEntry {
  actorId: string;
  action: 'CONSENT_SUPPRESSION_LIFTED';
  entity: 'channel_suppression';
  entityId: string;
  newState: { channel_key: string; rows_lifted: number; reason: string };
}

/** The general audit log, as this use case needs it. */
export type LiftSuppressionAuditSink = (entry: LiftSuppressionAuditEntry) => Promise<unknown>;

export type LiftChannelSuppressionResult =
  | { status: 'lifted'; channel_key: string; rows_lifted: number; audit_recorded: boolean }
  | { status: 'disabled'; reasons: string[] }
  | { status: 'invalid'; reasons: string[] }
  | { status: 'unsupported'; reasons: string[] }
  | { status: 'not_found'; reasons: string[] };

/**
 * Ends a channel suppression: a STOP recorded against the wrong contact, or a
 * customer who asks to hear from us again.
 *
 * - Same gate as recording one (CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED).
 * - A reason is required. Who, when and why are written on the suppression
 *   rows in the transaction that deactivates them (0164), so that record
 *   cannot be missing. Rows are never deleted.
 * - Channel-wide: every active row for that contact on that channel ends,
 *   whatever purpose each was scoped to.
 * - The audit-log row is the searchable copy. The contact is not written to
 *   it: channel and count only. A failed audit write is reported, never
 *   thrown, because the lift has already happened and is evidenced on the row.
 * - Lifting grants nothing: marketing still needs the customer's consent.
 */
export class LiftChannelSuppressionUseCase {
  constructor(
    private readonly repository: Pick<ConsentOperatingRepository, 'liftChannelSuppression'>,
    private readonly gates: ConsentFeatureGates,
    private readonly audit: LiftSuppressionAuditSink,
  ) {}

  async execute(input: { suppressionId: unknown; reason: unknown; actorId: string }): Promise<LiftChannelSuppressionResult> {
    if (!isConsentFeatureEnabled(this.gates, 'CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED')) {
      return { status: 'disabled', reasons: ['consent_provider_suppression_intake_enabled_is_disabled'] };
    }
    const suppressionId = typeof input.suppressionId === 'string' ? input.suppressionId.trim() : '';
    if (!SUPPRESSION_ID.test(suppressionId)) return { status: 'invalid', reasons: ['invalid_suppression_id'] };
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < LIFT_REASON_MIN || reason.length > LIFT_REASON_MAX) {
      return { status: 'invalid', reasons: ['reason_required_5_to_500_characters'] };
    }
    if (!input.actorId) return { status: 'invalid', reasons: ['actor_required'] };
    if (!this.repository.liftChannelSuppression) return { status: 'unsupported', reasons: ['lift_not_supported'] };

    const lifted = await this.repository.liftChannelSuppression(suppressionId, { actorId: input.actorId, reason });
    if (!lifted) return { status: 'not_found', reasons: ['suppression_not_found_or_not_active'] };

    const auditRecorded = await this.audit({
      actorId: input.actorId,
      action: 'CONSENT_SUPPRESSION_LIFTED',
      entity: 'channel_suppression',
      entityId: suppressionId,
      newState: { channel_key: lifted.channel_key, rows_lifted: lifted.lifted, reason },
    }).then(() => true, () => false);

    return { status: 'lifted', channel_key: lifted.channel_key, rows_lifted: lifted.lifted, audit_recorded: auditRecorded };
  }
}
