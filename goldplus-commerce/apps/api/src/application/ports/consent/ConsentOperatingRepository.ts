import type {
  ConsentActorType,
  ConsentIdentityLevel,
  ConsentState,
} from '../../../domain/consent/ConsentFoundation';
import type { ConsentProviderEligibilityPreviewInput } from '../../../domain/consent/ConsentProviderEligibilityPreview';

export const CONSENT_PURPOSE_KEYS = [
  'service_order_updates',
  'support_follow_up',
  'warranty_product_care',
  'product_education',
  'marketing_offers_campaigns',
  'loyalty_programme_updates',
  'quest_progress_and_badges',
  'memory_lane_annual_journey',
  'personalised_product_guidance',
  'utilisation_aware_offers',
  'research_feedback_surveys',
  'account_security_notifications',
] as const;

export const CONSENT_CHANNEL_KEYS = [
  'whatsapp',
  'email',
  'sms',
  'phone',
  'in_account',
  'support_assisted',
] as const;

export type ConsentPurposeKey = (typeof CONSENT_PURPOSE_KEYS)[number];
export type ConsentChannelKey = (typeof CONSENT_CHANNEL_KEYS)[number];

export interface ConsentAggregateKey {
  customer_identity_ref: string;
  endpoint_ref: string;
  purpose_key: ConsentPurposeKey;
  channel_key: ConsentChannelKey;
}

export interface ConsentCurrentState extends ConsentAggregateKey {
  state: ConsentState;
  identity_level: ConsentIdentityLevel;
  source_surface: string;
  copy_version_id: string | null;
  last_consent_event_id: string;
  effective_at: string;
  expires_at: string | null;
}

export interface ConsentEventWrite extends ConsentAggregateKey {
  consent_event_id: string;
  event_type: string;
  state: ConsentState;
  previous_state: ConsentState | null;
  new_state: ConsentState;
  identity_level: ConsentIdentityLevel;
  source_surface: string;
  actor_type: ConsentActorType;
  actor_id: string | null;
  copy_version_id: string | null;
  reason: string;
  correlation_id: string;
  idempotency_key: string;
  provider_callback_ref: string | null;
  support_ticket_ref: string | null;
  retention_policy: string;
  effective_at: string;
}

export interface ConsentMutationReceipt {
  consent_event_id: string;
  state: ConsentState;
  already_applied: boolean;
}

export interface ChannelSuppressionWrite {
  customer_identity_ref: string | null;
  endpoint_ref: string;
  channel_key: ConsentChannelKey;
  purpose_key: ConsentPurposeKey | null;
  scope: 'purpose' | 'channel';
  reason: string;
  source_surface: string;
  provider_callback_ref: string | null;
  correlation_id: string;
  idempotency_key: string;
  effective_at: string;
}

export interface ProviderUnsubscribeWrite extends ChannelSuppressionWrite {
  provider_key: string;
  provider_event_ref: string;
  authenticity_verified: boolean;
  freshness_verified: boolean;
  provider_occurred_at: string;
  normalized_evidence: Record<string, string | boolean | null>;
}

export interface SupportAssistedRequestWrite extends ConsentAggregateKey {
  requested_state: ConsentState;
  identity_level: ConsentIdentityLevel;
  verification_status: string;
  support_ticket_ref: string;
  actor_type: ConsentActorType;
  actor_id: string;
  script_copy_version_id: string;
  correlation_id: string;
  idempotency_key: string;
  expires_at: string;
}

export interface LegacyMappingResultWrite {
  mapping_version: string;
  legacy_system: string;
  legacy_field: string;
  legacy_value_class: string;
  target_purpose_key: ConsentPurposeKey | null;
  target_channel_key: ConsentChannelKey | null;
  mapping_outcome: 'unknown' | 'requested_support_assisted' | 'not_applicable';
  confidence: 'low' | 'medium' | 'high';
  reason: string;
  review_status: string;
  correlation_id: string;
  idempotency_key: string;
}

export interface PolicyBlockWrite {
  customer_identity_ref: string | null;
  cohort_ref: string | null;
  purpose_key: ConsentPurposeKey | null;
  channel_key: ConsentChannelKey | null;
  policy_block_reason: string;
  policy_version: string;
  actor_type: ConsentActorType;
  actor_id: string | null;
  correlation_id: string;
  idempotency_key: string;
  effective_at: string;
  expires_at: string | null;
}

export interface ConsentOperatingRepository {
  listPurposes(): Promise<Array<Record<string, unknown>>>;
  listChannels(): Promise<Array<Record<string, unknown>>>;
  listSourceSurfaces(): Promise<Array<Record<string, unknown>>>;
  getLatestConsentState(key: ConsentAggregateKey): Promise<ConsentCurrentState | null>;
  appendImmutableConsentEvent(event: ConsentEventWrite): Promise<ConsentMutationReceipt>;
  upsertCurrentConsentStateBySupersession(event: ConsentEventWrite): Promise<ConsentCurrentState>;
  commitStateChange(event: ConsentEventWrite): Promise<ConsentMutationReceipt>;
  recordCopyVersionReference(input: {
    copy_version_id: string;
    purpose_key: ConsentPurposeKey;
    channel_key: ConsentChannelKey;
    locale: string;
    content_hash: string;
    policy_version: string;
    effective_at: string;
  }): Promise<void>;
  recordChannelSuppression(input: ChannelSuppressionWrite): Promise<{ suppression_id: string }>;
  recordProviderUnsubscribeEvent(input: ProviderUnsubscribeWrite): Promise<{ event_id: string; already_applied: boolean }>;
  recordSupportAssistedRequest(input: SupportAssistedRequestWrite): Promise<{ request_id: string }>;
  recordLegacyMappingResult(input: LegacyMappingResultWrite): Promise<{ mapping_id: string }>;
  recordPolicyBlock(input: PolicyBlockWrite): Promise<{ block_id: string }>;
  queryAuditTimeline(customerIdentityRef: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  listSupportAssistedRequests(limit?: number): Promise<Array<Record<string, unknown>>>;
  listChannelSuppressions(limit?: number): Promise<Array<Record<string, unknown>>>;
  buildDryRunEligibilityInput(key: ConsentAggregateKey): Promise<ConsentProviderEligibilityPreviewInput>;
}
