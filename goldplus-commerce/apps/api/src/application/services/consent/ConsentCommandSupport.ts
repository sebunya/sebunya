import { createHash } from 'node:crypto';
import {
  CONSENT_ACTOR_TYPES,
  CONSENT_IDENTITY_LEVELS,
  type ConsentActorType,
  type ConsentIdentityLevel,
} from '../../../domain/consent/ConsentFoundation';
import {
  CONSENT_CHANNEL_KEYS,
  CONSENT_PURPOSE_KEYS,
  type ConsentChannelKey,
  type ConsentPurposeKey,
} from '../../ports/consent/ConsentOperatingRepository';

export interface ConsentCommandContext {
  actor_type: ConsentActorType;
  actor_id: string | null;
  identity_level: ConsentIdentityLevel;
  correlation_id: string;
  idempotency_key: string;
  reason: string;
}

export function requireConsentMutationContext(input: ConsentCommandContext): void {
  if (!CONSENT_ACTOR_TYPES.includes(input.actor_type)) throw new Error('invalid_actor_type');
  if (!CONSENT_IDENTITY_LEVELS.includes(input.identity_level)) throw new Error('invalid_identity_level');
  requireValue(input.correlation_id, 'correlation_id');
  requireValue(input.idempotency_key, 'idempotency_key');
  requireValue(input.reason, 'reason');
  if ((input.actor_type === 'admin' || input.actor_type === 'support_operator') && !input.actor_id?.trim()) {
    throw new Error('actor_id_required');
  }
}

export function requirePurposeChannel(purposeKey: string, channelKey: string): asserts purposeKey is ConsentPurposeKey {
  if (!CONSENT_PURPOSE_KEYS.includes(purposeKey as ConsentPurposeKey)) throw new Error('invalid_purpose_key');
  if (!CONSENT_CHANNEL_KEYS.includes(channelKey as ConsentChannelKey)) throw new Error('invalid_channel_key');
}

export function requireValue(value: string | null | undefined, field: string): asserts value is string {
  if (!value?.trim()) throw new Error(`${field}_required`);
}

export function consentEventIdFor(idempotencyKey: string, commandName: string): string {
  const hex = createHash('sha256').update(`${commandName}:${idempotencyKey}`, 'utf8').digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
