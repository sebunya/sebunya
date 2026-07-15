import { createHash } from 'node:crypto';

export const CONSENT_STATES = [
  'unknown',
  'not_requested',
  'requested_support_assisted',
  'pending_verification',
  'granted',
  'withdrawn',
  'expired',
  'superseded',
  'blocked_by_policy',
  'service_only',
] as const;

export const CONSENT_ACTOR_TYPES = [
  'customer',
  'support_operator',
  'admin',
  'provider_callback',
  'system_policy',
  'migration_dry_run',
  'test_fixture',
] as const;

export const CONSENT_IDENTITY_LEVELS = [
  'anonymous',
  'checkout_contact_only',
  'support_verified_contact',
  'verified_account',
  'provider_callback_verified',
  'admin_operator_confirmed',
] as const;

export type ConsentState = (typeof CONSENT_STATES)[number];
export type ConsentActorType = (typeof CONSENT_ACTOR_TYPES)[number];
export type ConsentIdentityLevel = (typeof CONSENT_IDENTITY_LEVELS)[number];

export interface ConsentAuditEnvelopeInput {
  consent_event_id: string;
  event_type: string;
  customer_identity_ref: string;
  purpose_key: string;
  channel_key: string;
  state: ConsentState;
  source_surface: string;
  actor_type: ConsentActorType;
  actor_id: string | null;
  timestamp: string;
  copy_version_id: string | null;
  previous_state: ConsentState | null;
  new_state: ConsentState;
  reason: string;
  correlation_id: string;
  provider_callback_ref?: string | null;
  support_ticket_ref?: string | null;
  retention_policy: string;
}

export type ConsentAuditEnvelope = Readonly<
  Required<Omit<ConsentAuditEnvelopeInput, 'provider_callback_ref' | 'support_ticket_ref'>> & {
    provider_callback_ref: string | null;
    support_ticket_ref: string | null;
  }
>;

function requireNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} is required`);
}

export function assertConsentStateTransitionShape(previous: ConsentState | null, next: ConsentState): void {
  if (previous !== null && !CONSENT_STATES.includes(previous)) throw new Error('invalid previous consent state');
  if (!CONSENT_STATES.includes(next)) throw new Error('invalid new consent state');
}

export function assertConsentIdentityLevelShape(level: ConsentIdentityLevel): void {
  if (!CONSENT_IDENTITY_LEVELS.includes(level)) throw new Error('invalid consent identity level');
}

export function createConsentAuditEnvelope(input: ConsentAuditEnvelopeInput): ConsentAuditEnvelope {
  for (const [field, value] of Object.entries({
    consent_event_id: input.consent_event_id,
    event_type: input.event_type,
    customer_identity_ref: input.customer_identity_ref,
    purpose_key: input.purpose_key,
    channel_key: input.channel_key,
    source_surface: input.source_surface,
    timestamp: input.timestamp,
    reason: input.reason,
    correlation_id: input.correlation_id,
    retention_policy: input.retention_policy,
  })) requireNonBlank(value, field);

  assertConsentStateTransitionShape(input.previous_state, input.new_state);
  if (input.state !== input.new_state) throw new Error('state must equal new_state');
  if (!CONSENT_ACTOR_TYPES.includes(input.actor_type)) throw new Error('invalid actor type');
  if (Number.isNaN(Date.parse(input.timestamp))) throw new Error('timestamp must be ISO-compatible');

  return Object.freeze({
    ...input,
    provider_callback_ref: input.provider_callback_ref ?? null,
    support_ticket_ref: input.support_ticket_ref ?? null,
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

export function hashConsentAuditEnvelope(envelope: ConsentAuditEnvelope): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(envelope)), 'utf8').digest('hex');
}

export interface ProviderSuppressionShape {
  channel_key: string;
  suppression_active: boolean;
  provider_stop_or_unsubscribe: boolean;
}

export function assertProviderSuppressionShape(input: ProviderSuppressionShape): void {
  requireNonBlank(input.channel_key, 'channel_key');
  if (input.provider_stop_or_unsubscribe && !input.suppression_active) {
    throw new Error('provider STOP/unsubscribe must suppress the affected channel');
  }
}

export function assertLegacyMappingIsNotAutoGrant(proposedState: ConsentState): void {
  if (proposedState === 'granted') throw new Error('legacy broad flags cannot automatically grant consent');
}

export function assertNoCheckoutContactMarketingGrant(
  identityLevel: ConsentIdentityLevel,
  optionalMarketing: boolean,
  proposedState: ConsentState,
): void {
  if (identityLevel === 'checkout_contact_only' && optionalMarketing && proposedState === 'granted') {
    throw new Error('checkout contact cannot authorize optional marketing');
  }
}

export function assertNoAnonymousConsentGrant(
  identityLevel: ConsentIdentityLevel,
  proposedState: ConsentState,
): void {
  if (identityLevel === 'anonymous' && proposedState === 'granted') {
    throw new Error('anonymous identity cannot grant consent');
  }
}

export function assertPolicyBlockPrecedence(policyBlockActive: boolean, currentState: ConsentState): ConsentState {
  return policyBlockActive ? 'blocked_by_policy' : currentState;
}

export function assertWithdrawalSupersedesGrant(withdrawalActive: boolean, currentState: ConsentState): ConsentState {
  return withdrawalActive && currentState === 'granted' ? 'withdrawn' : currentState;
}
