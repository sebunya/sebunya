import { describe, expect, it } from 'vitest';
import { authorizePilotPreferenceSave, buildPilotRingStatus, hashPilotIdentity, maskPilotIdentity, parsePilotAllowlist } from '../../apps/api/src/application/services/consent/ConsentPilotRing';

const base = {
  pilot_save_enabled: true,
  identity_ring: 'ring_1_allowlisted_verified_pilot' as const,
  identity_classification: 'verified_account' as const,
  identity_verified: true,
  identity_allowlisted: true,
  purpose_key: 'marketing_offers_campaigns',
  channel_key: 'email',
  requested_state: 'granted' as const,
  correlation_id: 'corr-10-ab',
  idempotency_key: 'idem-10-ab',
  copy_version: 'account-consent-p0-v1',
  source_surface: 'account_preference_centre_p0',
  audit_required: true,
  provider_live_sends: false,
  provider_transport_requested: false,
};

describe('Slice 10-AB Apex consent pilot ring', () => {
  it('hashes and masks identity without exposing the raw value', () => { const raw = 'uat-synthetic@example.test'; expect(hashPilotIdentity(raw)).toMatch(/^identity_[a-f0-9]{24}$/); expect(maskPilotIdentity(raw)).toBe('ua***@ex***'); expect(maskPilotIdentity(raw)).not.toContain(raw); });
  it('parses only hashed configured allowlist entries', () => { const record = parsePilotAllowlist(`${hashPilotIdentity('pilot@example.test')},pilot@example.test,identity_bad`); expect(record).toHaveLength(1); expect(record[0].masked_identity).toBe('configured-allowlist-entry'); });
  it('allows a verified allowlisted pilot grant', () => { expect(authorizePilotPreferenceSave(base)).toEqual({ ok: true }); });
  it('allows a withdrawal in the pilot ring', () => { expect(authorizePilotPreferenceSave({ ...base, requested_state: 'withdrawn' })).toEqual({ ok: true }); });
  it('allows Ring 0 synthetic internal UAT', () => { expect(authorizePilotPreferenceSave({ ...base, identity_ring: 'ring_0_internal_uat', identity_classification: 'synthetic_internal', identity_allowlisted: false })).toEqual({ ok: true }); });
  it.each(['ring_2_public_read_only', 'ring_3_blocked_external'] as const)('blocks %s writes', ring => { const result = authorizePilotPreferenceSave({ ...base, identity_ring: ring }); expect(result.ok).toBe(false); });
  it.each(['anonymous', 'checkout_contact_only', 'support_only', 'legacy_imported', 'unknown_imported'] as const)('blocks %s identities', identity_classification => { const result = authorizePilotPreferenceSave({ ...base, identity_classification }); expect(result.ok).toBe(false); });
  it('requires verification and allowlisting for Ring 1', () => { expect(authorizePilotPreferenceSave({ ...base, identity_verified: false }).ok).toBe(false); expect(authorizePilotPreferenceSave({ ...base, identity_allowlisted: false }).ok).toBe(false); });
  it('requires canonical purpose and channel', () => { expect(authorizePilotPreferenceSave({ ...base, purpose_key: '' }).ok).toBe(false); expect(authorizePilotPreferenceSave({ ...base, channel_key: '' }).ok).toBe(false); });
  it('requires correlation, idempotency, copy and source', () => { for (const key of ['correlation_id', 'idempotency_key', 'copy_version', 'source_surface'] as const) expect(authorizePilotPreferenceSave({ ...base, [key]: '' }).ok).toBe(false); });
  it('requires audit and disabled live sends', () => { expect(authorizePilotPreferenceSave({ ...base, audit_required: false }).ok).toBe(false); expect(authorizePilotPreferenceSave({ ...base, provider_live_sends: true }).ok).toBe(false); });
  it('rejects transport, queue, campaign and unrelated side effects', () => { expect(authorizePilotPreferenceSave({ ...base, provider_transport_requested: true }).ok).toBe(false); expect(authorizePilotPreferenceSave({ ...base, queue_send_requested: true }).ok).toBe(false); expect(authorizePilotPreferenceSave({ ...base, campaign_id: 'campaign' }).ok).toBe(false); expect(authorizePilotPreferenceSave({ ...base, newsletter_id: 'newsletter' }).ok).toBe(false); expect(authorizePilotPreferenceSave({ ...base, side_effect_requested: true }).ok).toBe(false); });
  it('fails closed when pilot save is disabled', () => { const result = authorizePilotPreferenceSave({ ...base, pilot_save_enabled: false }); expect(result.ok).toBe(false); });
  it('returns truthful ring status', () => { const status = buildPilotRingStatus({ save_enabled: false, allowlist_count: 0, cooldown_safe_to_attempt: false }); expect(status.ring_0).toBe('internal_uat'); expect(status.ring_1).toBe('ready_save_blocked_no_safe_identity'); expect(status.ring_2).toBe('public_read_only'); expect(status.ring_3).toContain('blocked'); expect(status.provider_sends_enabled).toBe(false); });
  it('never treats unknown identity as eligible', () => { expect(authorizePilotPreferenceSave({ ...base, identity_ring: 'ring_3_blocked_external', identity_classification: 'unknown_imported' }).ok).toBe(false); });
  it('does not authorize provider eligibility semantics', () => { const result = authorizePilotPreferenceSave({ ...base, requested_state: 'withdrawn' }); expect(result).toEqual({ ok: true }); });
  it('reports all blockers without raw identity', () => { const result = authorizePilotPreferenceSave({ ...base, identity_ring: 'ring_2_public_read_only', identity_classification: 'anonymous', correlation_id: '', idempotency_key: '' }); expect(result.ok).toBe(false); if (!result.ok) expect(result.reasons.join('|')).not.toContain('@'); });
});
