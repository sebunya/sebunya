import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type {
  ChannelSuppressionWrite,
  ConsentAggregateKey,
  ConsentCurrentState,
  ConsentEventWrite,
  ConsentMutationReceipt,
  ConsentOperatingRepository,
  LegacyMappingResultWrite,
  PolicyBlockWrite,
  ProviderUnsubscribeWrite,
  SupportAssistedRequestWrite,
} from '../../application/ports/consent/ConsentOperatingRepository';
import {
  createConsentAuditEnvelope,
  hashConsentAuditEnvelope,
} from '../../domain/consent/ConsentFoundation';
import type { ConsentProviderEligibilityPreviewInput } from '../../domain/consent/ConsentProviderEligibilityPreview';
import { db } from '../db/client';
import {
  channelSuppressions,
  consentChannels,
  consentCopyVersions,
  consentEvents,
  consentPolicyBlocks,
  consentPurposes,
  consentSourceSurfaces,
  customerConsentStates,
  legacyPreferenceMappings,
  providerUnsubscribeEvents,
  supportAssistedPreferenceRequests,
} from '../db/schema/consent-foundation';

function asDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid_effective_timestamp');
  return parsed;
}

function stableUuid(namespace: string, key: string): string {
  const hex = createHash('sha256').update(`${namespace}:${key}`, 'utf8').digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function mapState(row: typeof customerConsentStates.$inferSelect): ConsentCurrentState {
  return {
    customer_identity_ref: row.customerIdentityRef,
    endpoint_ref: row.endpointRef,
    purpose_key: row.purposeKey as ConsentCurrentState['purpose_key'],
    channel_key: row.channelKey as ConsentCurrentState['channel_key'],
    state: row.state,
    identity_level: row.identityVerificationLevel,
    source_surface: row.sourceSurface,
    copy_version_id: row.copyVersionId,
    last_consent_event_id: row.lastConsentEventId ?? '',
    effective_at: row.effectiveAt.toISOString(),
    expires_at: row.expiresAt?.toISOString() ?? null,
  };
}

function eventValues(event: ConsentEventWrite) {
  const envelope = createConsentAuditEnvelope({
    consent_event_id: event.consent_event_id,
    event_type: event.event_type,
    customer_identity_ref: event.customer_identity_ref,
    purpose_key: event.purpose_key,
    channel_key: event.channel_key,
    state: event.state,
    source_surface: event.source_surface,
    actor_type: event.actor_type,
    actor_id: event.actor_id,
    timestamp: event.effective_at,
    copy_version_id: event.copy_version_id,
    previous_state: event.previous_state,
    new_state: event.new_state,
    reason: event.reason,
    correlation_id: event.correlation_id,
    provider_callback_ref: event.provider_callback_ref,
    support_ticket_ref: event.support_ticket_ref,
    retention_policy: event.retention_policy,
  });
  return {
    consentEventId: event.consent_event_id,
    eventType: event.event_type,
    customerIdentityRef: event.customer_identity_ref,
    endpointRef: event.endpoint_ref,
    purposeKey: event.purpose_key,
    channelKey: event.channel_key,
    state: event.state,
    sourceSurface: event.source_surface,
    actorType: event.actor_type,
    actorId: event.actor_id,
    copyVersionId: event.copy_version_id,
    previousState: event.previous_state,
    newState: event.new_state,
    reason: event.reason,
    providerCallbackRef: event.provider_callback_ref,
    supportTicketRef: event.support_ticket_ref,
    correlationId: event.correlation_id,
    retentionPolicy: event.retention_policy,
    integrityHash: hashConsentAuditEnvelope(envelope),
    tamperEvidenceRef: null,
    effectiveAt: asDate(event.effective_at),
  };
}

function stateValues(event: ConsentEventWrite) {
  return {
    customerIdentityRef: event.customer_identity_ref,
    endpointRef: event.endpoint_ref,
    purposeKey: event.purpose_key,
    channelKey: event.channel_key,
    identityVerificationLevel: event.identity_level,
    state: event.new_state,
    sourceSurface: event.source_surface,
    copyVersionId: event.copy_version_id,
    lastConsentEventId: event.consent_event_id,
    effectiveAt: asDate(event.effective_at),
    expiresAt: null,
    supersededBy: null,
  };
}

export class DrizzleConsentOperatingRepository implements ConsentOperatingRepository {
  async listPurposes(): Promise<Array<Record<string, unknown>>> {
    return db.select().from(consentPurposes).orderBy(consentPurposes.purposeKey, desc(consentPurposes.effectiveAt));
  }

  async listChannels(): Promise<Array<Record<string, unknown>>> {
    return db.select().from(consentChannels).orderBy(consentChannels.channelKey, desc(consentChannels.effectiveAt));
  }

  async listSourceSurfaces(): Promise<Array<Record<string, unknown>>> {
    return db.select().from(consentSourceSurfaces).orderBy(consentSourceSurfaces.sourceSurface);
  }

  async getLatestConsentState(key: ConsentAggregateKey): Promise<ConsentCurrentState | null> {
    const [row] = await db.select().from(customerConsentStates).where(and(
      eq(customerConsentStates.customerIdentityRef, key.customer_identity_ref),
      eq(customerConsentStates.endpointRef, key.endpoint_ref),
      eq(customerConsentStates.purposeKey, key.purpose_key),
      eq(customerConsentStates.channelKey, key.channel_key),
    )).limit(1);
    return row ? mapState(row) : null;
  }

  async appendImmutableConsentEvent(event: ConsentEventWrite): Promise<ConsentMutationReceipt> {
    const [existing] = await db.select({ id: consentEvents.consentEventId, state: consentEvents.newState })
      .from(consentEvents)
      .where(eq(consentEvents.consentEventId, event.consent_event_id))
      .limit(1);
    if (existing) return { consent_event_id: existing.id, state: existing.state, already_applied: true };
    await db.insert(consentEvents).values(eventValues(event));
    return { consent_event_id: event.consent_event_id, state: event.new_state, already_applied: false };
  }

  async upsertCurrentConsentStateBySupersession(event: ConsentEventWrite): Promise<ConsentCurrentState> {
    const [row] = await db.insert(customerConsentStates).values(stateValues(event)).onConflictDoUpdate({
      target: [
        customerConsentStates.customerIdentityRef,
        customerConsentStates.endpointRef,
        customerConsentStates.purposeKey,
        customerConsentStates.channelKey,
      ],
      set: stateValues(event),
    }).returning();
    return mapState(row);
  }

  async commitStateChange(event: ConsentEventWrite): Promise<ConsentMutationReceipt> {
    return db.transaction(async tx => {
      const [existing] = await tx.select({ id: consentEvents.consentEventId, state: consentEvents.newState })
        .from(consentEvents)
        .where(eq(consentEvents.consentEventId, event.consent_event_id))
        .limit(1);
      if (existing) return { consent_event_id: existing.id, state: existing.state, already_applied: true };

      await tx.insert(consentEvents).values(eventValues(event));
      await tx.insert(customerConsentStates).values(stateValues(event)).onConflictDoUpdate({
        target: [
          customerConsentStates.customerIdentityRef,
          customerConsentStates.endpointRef,
          customerConsentStates.purposeKey,
          customerConsentStates.channelKey,
        ],
        set: stateValues(event),
      });
      return { consent_event_id: event.consent_event_id, state: event.new_state, already_applied: false };
    });
  }

  async recordCopyVersionReference(input: {
    copy_version_id: string;
    purpose_key: ConsentEventWrite['purpose_key'];
    channel_key: ConsentEventWrite['channel_key'];
    locale: string;
    content_hash: string;
    policy_version: string;
    effective_at: string;
  }): Promise<void> {
    await db.insert(consentCopyVersions).values({
      copyVersionId: input.copy_version_id,
      purposeKey: input.purpose_key,
      channelKey: input.channel_key,
      locale: input.locale,
      contentHash: input.content_hash,
      policyVersion: input.policy_version,
      effectiveAt: asDate(input.effective_at),
    }).onConflictDoNothing({ target: consentCopyVersions.copyVersionId });
  }

  async recordChannelSuppression(input: ChannelSuppressionWrite): Promise<{ suppression_id: string }> {
    const suppressionId = stableUuid('channel-suppression', input.idempotency_key);
    await db.insert(channelSuppressions).values({
      id: suppressionId,
      customerIdentityRef: input.customer_identity_ref,
      endpointRef: input.endpoint_ref,
      channelKey: input.channel_key,
      purposeKey: input.purpose_key,
      scope: input.scope,
      reason: input.reason,
      sourceSurface: input.source_surface,
      providerCallbackRef: input.provider_callback_ref,
      suppressionActive: true,
      effectiveAt: asDate(input.effective_at),
    }).onConflictDoNothing({ target: channelSuppressions.id });
    return { suppression_id: suppressionId };
  }

  async recordProviderUnsubscribeEvent(input: ProviderUnsubscribeWrite): Promise<{ event_id: string; already_applied: boolean }> {
    const [existing] = await db.select({ id: providerUnsubscribeEvents.id }).from(providerUnsubscribeEvents).where(and(
      eq(providerUnsubscribeEvents.providerKey, input.provider_key),
      eq(providerUnsubscribeEvents.providerEventRef, input.provider_event_ref),
    )).limit(1);
    if (existing) return { event_id: existing.id, already_applied: true };

    const eventId = stableUuid('provider-unsubscribe', `${input.provider_key}:${input.provider_event_ref}`);
    const integrityHash = hashConsentAuditEnvelope(createConsentAuditEnvelope({
      consent_event_id: eventId,
      event_type: 'provider_unsubscribe_recorded',
      customer_identity_ref: input.customer_identity_ref ?? 'endpoint-only',
      purpose_key: input.purpose_key ?? 'marketing_offers_campaigns',
      channel_key: input.channel_key,
      state: 'withdrawn',
      source_surface: input.source_surface,
      actor_type: 'provider_callback',
      actor_id: input.provider_key,
      timestamp: input.effective_at,
      copy_version_id: null,
      previous_state: null,
      new_state: 'withdrawn',
      reason: input.reason,
      correlation_id: input.correlation_id,
      provider_callback_ref: input.provider_callback_ref,
      support_ticket_ref: null,
      retention_policy: 'provider-suppression-v1',
    }));
    await db.insert(providerUnsubscribeEvents).values({
      id: eventId,
      providerKey: input.provider_key,
      providerEventRef: input.provider_event_ref,
      providerCallbackRef: input.provider_callback_ref ?? input.provider_event_ref,
      endpointRef: input.endpoint_ref,
      channelKey: input.channel_key,
      purposeKey: input.purpose_key,
      scope: input.scope,
      authenticityVerified: input.authenticity_verified,
      freshnessVerified: input.freshness_verified,
      providerOccurredAt: asDate(input.provider_occurred_at),
      correlationId: input.correlation_id,
      integrityHash,
      tamperEvidenceRef: null,
      normalizedEvidence: input.normalized_evidence,
    });
    return { event_id: eventId, already_applied: false };
  }

  async recordSupportAssistedRequest(input: SupportAssistedRequestWrite): Promise<{ request_id: string }> {
    const requestId = stableUuid('support-assisted-request', input.idempotency_key);
    await db.insert(supportAssistedPreferenceRequests).values({
      id: requestId,
      customerIdentityRef: input.customer_identity_ref,
      endpointRef: input.endpoint_ref,
      purposeKey: input.purpose_key,
      channelKey: input.channel_key,
      requestedState: input.requested_state,
      identityVerificationLevel: input.identity_level,
      verificationStatus: input.verification_status,
      supportTicketRef: input.support_ticket_ref,
      actorType: input.actor_type,
      actorId: input.actor_id,
      scriptCopyVersionId: input.script_copy_version_id,
      correlationId: input.correlation_id,
      expiresAt: asDate(input.expires_at),
    }).onConflictDoNothing({ target: supportAssistedPreferenceRequests.id });
    return { request_id: requestId };
  }

  async recordLegacyMappingResult(input: LegacyMappingResultWrite): Promise<{ mapping_id: string }> {
    const mappingId = stableUuid('legacy-mapping-result', input.idempotency_key);
    await db.insert(legacyPreferenceMappings).values({
      id: mappingId,
      mappingVersion: input.mapping_version,
      legacySystem: input.legacy_system,
      legacyField: input.legacy_field,
      legacyValueClass: input.legacy_value_class,
      targetPurposeKey: input.target_purpose_key,
      targetChannelKey: input.target_channel_key,
      mappingOutcome: input.mapping_outcome,
      confidence: input.confidence,
      reason: input.reason,
      reviewStatus: input.review_status,
      effectiveAt: new Date(),
    }).onConflictDoNothing({
      target: [
        legacyPreferenceMappings.mappingVersion,
        legacyPreferenceMappings.legacySystem,
        legacyPreferenceMappings.legacyField,
        legacyPreferenceMappings.legacyValueClass,
      ],
    });
    return { mapping_id: mappingId };
  }

  async recordPolicyBlock(input: PolicyBlockWrite): Promise<{ block_id: string }> {
    const blockId = stableUuid('policy-block', input.idempotency_key);
    const integrityHash = createHashForPolicyBlock(blockId, input);
    await db.insert(consentPolicyBlocks).values({
      id: blockId,
      customerIdentityRef: input.customer_identity_ref,
      cohortRef: input.cohort_ref,
      purposeKey: input.purpose_key,
      channelKey: input.channel_key,
      policyBlockReason: input.policy_block_reason,
      policyVersion: input.policy_version,
      actorType: input.actor_type,
      actorId: input.actor_id,
      correlationId: input.correlation_id,
      integrityHash,
      tamperEvidenceRef: null,
      effectiveAt: asDate(input.effective_at),
      expiresAt: input.expires_at ? asDate(input.expires_at) : null,
    }).onConflictDoNothing({ target: consentPolicyBlocks.id });
    return { block_id: blockId };
  }

  async queryAuditTimeline(customerIdentityRef: string, limit = 100): Promise<Array<Record<string, unknown>>> {
    return db.select({
      consent_event_id: consentEvents.consentEventId,
      event_type: consentEvents.eventType,
      purpose_key: consentEvents.purposeKey,
      channel_key: consentEvents.channelKey,
      previous_state: consentEvents.previousState,
      new_state: consentEvents.newState,
      source_surface: consentEvents.sourceSurface,
      actor_type: consentEvents.actorType,
      reason: consentEvents.reason,
      correlation_id: consentEvents.correlationId,
      effective_at: consentEvents.effectiveAt,
    }).from(consentEvents)
      .where(eq(consentEvents.customerIdentityRef, customerIdentityRef))
      .orderBy(desc(consentEvents.effectiveAt))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  async listSupportAssistedRequests(limit = 100): Promise<Array<Record<string, unknown>>> {
    return db.select().from(supportAssistedPreferenceRequests)
      .orderBy(desc(supportAssistedPreferenceRequests.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  async listChannelSuppressions(limit = 100): Promise<Array<Record<string, unknown>>> {
    return db.select().from(channelSuppressions)
      .where(eq(channelSuppressions.suppressionActive, true))
      .orderBy(desc(channelSuppressions.effectiveAt))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  async buildDryRunEligibilityInput(key: ConsentAggregateKey): Promise<ConsentProviderEligibilityPreviewInput> {
    const current = await this.getLatestConsentState(key);
    const [suppression] = await db.select({ id: channelSuppressions.id }).from(channelSuppressions).where(and(
      eq(channelSuppressions.endpointRef, key.endpoint_ref),
      eq(channelSuppressions.channelKey, key.channel_key),
      eq(channelSuppressions.suppressionActive, true),
      or(isNull(channelSuppressions.purposeKey), eq(channelSuppressions.purposeKey, key.purpose_key)),
    )).limit(1);
    const [providerSuppressionEvidence] = await db.select({ id: providerUnsubscribeEvents.id })
      .from(providerUnsubscribeEvents)
      .where(and(
        eq(providerUnsubscribeEvents.endpointRef, key.endpoint_ref),
        eq(providerUnsubscribeEvents.channelKey, key.channel_key),
        eq(providerUnsubscribeEvents.authenticityVerified, true),
        eq(providerUnsubscribeEvents.freshnessVerified, true),
        or(isNull(providerUnsubscribeEvents.purposeKey), eq(providerUnsubscribeEvents.purposeKey, key.purpose_key)),
      ))
      .limit(1);
    const [policyBlock] = await db.select({ id: consentPolicyBlocks.id }).from(consentPolicyBlocks).where(and(
      or(
        eq(consentPolicyBlocks.customerIdentityRef, key.customer_identity_ref),
        isNull(consentPolicyBlocks.customerIdentityRef),
      ),
      or(isNull(consentPolicyBlocks.purposeKey), eq(consentPolicyBlocks.purposeKey, key.purpose_key)),
      or(isNull(consentPolicyBlocks.channelKey), eq(consentPolicyBlocks.channelKey, key.channel_key)),
    )).limit(1);

    return {
      purpose_key: key.purpose_key,
      channel_key: key.channel_key,
      consent_state: current?.state ?? 'unknown',
      identity_level: current?.identity_level ?? 'anonymous',
      optional_marketing: key.purpose_key === 'marketing_offers_campaigns',
      policy_block_active: Boolean(policyBlock),
      withdrawal_active: current?.state === 'withdrawn',
      provider_suppression_active: Boolean(suppression || providerSuppressionEvidence),
      template_required: ['email', 'sms', 'whatsapp'].includes(key.channel_key),
      template_approved: false,
      copy_version_present: Boolean(current?.copy_version_id),
      provider_credential_configured: false,
      provider_delivery_enabled: false,
      message_category_matches_purpose: true,
    };
  }
}

function createHashForPolicyBlock(blockId: string, input: PolicyBlockWrite): string {
  const envelope = createConsentAuditEnvelope({
    consent_event_id: blockId,
    event_type: 'policy_block_recorded',
    customer_identity_ref: input.customer_identity_ref ?? input.cohort_ref ?? 'policy-scope',
    purpose_key: input.purpose_key ?? 'service_order_updates',
    channel_key: input.channel_key ?? 'in_account',
    state: 'blocked_by_policy',
    source_surface: 'policy_control',
    actor_type: input.actor_type,
    actor_id: input.actor_id,
    timestamp: input.effective_at,
    copy_version_id: null,
    previous_state: null,
    new_state: 'blocked_by_policy',
    reason: input.policy_block_reason,
    correlation_id: input.correlation_id,
    retention_policy: 'policy-block-v1',
  });
  return hashConsentAuditEnvelope(envelope);
}
