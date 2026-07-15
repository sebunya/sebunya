import { createHash } from 'node:crypto';
import type { ConsentChannelKey, ConsentPurposeKey } from '../../ports/consent/ConsentOperatingRepository';

export type ConsentPilotRing = 'ring_0_internal_uat' | 'ring_1_allowlisted_verified_pilot' | 'ring_2_public_read_only' | 'ring_3_blocked_external';
export type PilotIdentityClassification = 'synthetic_internal' | 'verified_account' | 'anonymous' | 'checkout_contact_only' | 'support_only' | 'legacy_imported' | 'unknown_imported';

export interface PilotAllowlistRecord {
  identity_hash: string;
  masked_identity: string;
  ring: 'ring_1_allowlisted_verified_pilot';
  source: 'configured_hash_allowlist' | 'synthetic_uat';
  configured_at: string;
}

export type PilotProvisioningSource = 'synthetic' | 'root_only' | 'admin' | 'chat' | 'public_form' | 'checkout' | 'support' | 'legacy';

export function provisionPilotIdentity(identity: string, source: PilotProvisioningSource, configuredAt = new Date().toISOString()): PilotAllowlistRecord {
  if (!['synthetic', 'root_only', 'admin'].includes(source)) throw new Error('unsafe_pilot_provisioning_source');
  const normalized = identity.trim().toLowerCase();
  if (!normalized) throw new Error('pilot_identity_required');
  return Object.freeze({
    identity_hash: hashPilotIdentity(normalized),
    masked_identity: maskPilotIdentity(normalized),
    ring: 'ring_1_allowlisted_verified_pilot',
    source: source === 'synthetic' ? 'synthetic_uat' : 'configured_hash_allowlist',
    configured_at: configuredAt,
  });
}

export interface PilotSaveInput {
  pilot_save_enabled: boolean;
  identity_ring: ConsentPilotRing;
  identity_classification: PilotIdentityClassification;
  identity_verified: boolean;
  identity_allowlisted: boolean;
  purpose_key: string;
  channel_key: string;
  requested_state: 'granted' | 'withdrawn';
  correlation_id: string;
  idempotency_key: string;
  copy_version: string;
  source_surface: string;
  audit_required: boolean;
  provider_live_sends: boolean;
  provider_transport_requested: boolean;
  queue_send_requested?: boolean;
  campaign_id?: string | null;
  newsletter_id?: string | null;
  side_effect_requested?: boolean;
}

export function hashPilotIdentity(identity: string): string {
  return `identity_${createHash('sha256').update(identity.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 24)}`;
}

export function maskPilotIdentity(identity: string): string {
  const value = identity.trim();
  if (!value) return 'unknown';
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${local.slice(0, 2)}***@${domain.slice(0, 2)}***`;
  }
  return `${value.slice(0, 3)}***`;
}

export function parsePilotAllowlist(source: string | undefined, configuredAt = new Date().toISOString()): readonly PilotAllowlistRecord[] {
  return Object.freeze((source ?? '').split(',').map(value => value.trim()).filter(Boolean).filter(value => /^identity_[a-f0-9]{24}$/.test(value)).map(identity_hash => ({
    identity_hash,
    masked_identity: 'configured-allowlist-entry',
    ring: 'ring_1_allowlisted_verified_pilot' as const,
    source: 'configured_hash_allowlist' as const,
    configured_at: configuredAt,
  })));
}

export function authorizePilotPreferenceSave(input: Readonly<PilotSaveInput>): { ok: true } | { ok: false; reasons: readonly string[] } {
  const reasons: string[] = [];
  if (!input.pilot_save_enabled) reasons.push('pilot_save_is_disabled');
  if (!['ring_0_internal_uat', 'ring_1_allowlisted_verified_pilot'].includes(input.identity_ring)) reasons.push('identity_ring_not_write_enabled');
  if (input.identity_ring === 'ring_1_allowlisted_verified_pilot' && !input.identity_verified) reasons.push('pilot_identity_verification_required');
  if (input.identity_ring === 'ring_1_allowlisted_verified_pilot' && !input.identity_allowlisted) reasons.push('pilot_identity_allowlist_required');
  if (['anonymous', 'checkout_contact_only', 'support_only', 'legacy_imported', 'unknown_imported'].includes(input.identity_classification)) reasons.push('identity_classification_not_allowed');
  if (!input.purpose_key || !input.channel_key) reasons.push('canonical_purpose_and_channel_required');
  if (!['granted', 'withdrawn'].includes(input.requested_state)) reasons.push('explicit_state_required');
  if (!input.correlation_id) reasons.push('correlation_id_required');
  if (!input.idempotency_key) reasons.push('idempotency_key_required');
  if (!input.copy_version) reasons.push('copy_version_required');
  if (!input.source_surface.startsWith('account_preference_centre')) reasons.push('preference_centre_source_required');
  if (!input.audit_required) reasons.push('audit_required');
  if (input.provider_live_sends) reasons.push('provider_live_sends_must_remain_disabled');
  if (input.provider_transport_requested) reasons.push('provider_transport_not_allowed');
  if (input.queue_send_requested) reasons.push('queue_send_not_allowed');
  if (input.campaign_id || input.newsletter_id) reasons.push('campaign_or_newsletter_not_allowed');
  if (input.side_effect_requested) reasons.push('unrelated_side_effect_not_allowed');
  return reasons.length ? { ok: false, reasons: Object.freeze(reasons) } : { ok: true };
}

export function buildPilotRingStatus(input: { save_enabled: boolean; allowlist_count: number; cooldown_safe_to_attempt: boolean }) {
  return Object.freeze({ ring_0: 'internal_uat', ring_1: input.allowlist_count > 0 ? 'allowlisted_verified_pilot' : 'ready_save_blocked_no_safe_identity', ring_2: 'public_read_only', ring_3: 'blocked_unless_verified_and_allowlisted', save_enabled: input.save_enabled, provider_sends_enabled: false, cooldown_safe_to_attempt: input.cooldown_safe_to_attempt });
}

export type { ConsentPurposeKey, ConsentChannelKey };
