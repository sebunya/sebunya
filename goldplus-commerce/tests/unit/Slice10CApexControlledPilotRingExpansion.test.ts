import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ControlledPilotCohort,
  authorizePilotPreferenceSave,
  buildPilotRingStatus,
  hashPilotIdentity,
  maskPilotIdentity,
  parsePilotAllowlist,
  provisionPilotIdentity,
  type PilotIdentityClassification,
  type PilotProvisioningSource,
  type PilotSaveInput,
} from '../../apps/api/src/application/services/consent/ConsentPilotRing';

const root = resolve(import.meta.dirname, '../..');
const runtimePath = 'apps/api/src/application/services/consent/ConsentPilotRing.ts';
const runtimeSource = readFileSync(resolve(root, runtimePath), 'utf8').toLowerCase();

const base: PilotSaveInput = {
  pilot_save_enabled: true,
  identity_ring: 'ring_1_allowlisted_verified_pilot',
  identity_classification: 'verified_account',
  identity_verified: true,
  identity_allowlisted: true,
  purpose_key: 'marketing_offers_campaigns',
  channel_key: 'email',
  requested_state: 'granted',
  correlation_id: 'corr-10-c',
  idempotency_key: 'idem-10-c',
  copy_version: 'account-consent-p0-v1',
  source_surface: 'account_preference_centre_pilot',
  audit_required: true,
  provider_live_sends: false,
  provider_transport_requested: false,
};

const validIdentities = Array.from({ length: 24 }, (_, index) =>
  `pilot-${String(index + 1).padStart(2, '0')}@example.test`,
);
const validHashes = Array.from({ length: 20 }, (_, index) =>
  `identity_${(index + 1).toString(16).padStart(24, '0')}`,
);

describe('Slice 10-C runtime artifact contract', () => {
  [
    'default_pilot_cohort_cap = 3',
    'consent_preference_save_pilot',
    'ring_1_allowlisted_verified_pilot',
    'ring_2_public_read_only',
    'ring_3_blocked_external',
    'pilot_cohort_cap_out_of_bounds',
    'pilot_cohort_cap_reached',
    'pilot_ring_disabled',
    'unsafe_pilot_provisioning_source',
    'pilot_identity_required',
    'pilot_save_is_disabled',
    'identity_ring_not_write_enabled',
    'pilot_identity_verification_required',
    'pilot_identity_allowlist_required',
    'identity_classification_not_allowed',
    'canonical_purpose_and_channel_required',
    'explicit_state_required',
    'correlation_id_required',
    'idempotency_key_required',
    'copy_version_required',
    'preference_centre_source_required',
    'audit_required',
    'provider_live_sends_must_remain_disabled',
    'provider_transport_not_allowed',
    'queue_send_not_allowed',
    'campaign_or_newsletter_not_allowed',
    'unrelated_side_effect_not_allowed',
    'provider_sends_enabled: false',
    "email_cooldown_status: 'unknown'",
    'cooldown_safe_to_attempt',
  ].forEach(token => {
    it(`retains required safety token ${token}`, () => expect(runtimeSource).toContain(token));
  });

  [
    'fetch(',
    'axios',
    'zeptomail',
    'twilio',
    'whatsappadapter',
    'pahappacomms',
    'pesapal',
    'checkoutusecase',
    'authmiddleware',
    'credentialvault',
    'db.insert',
    'db.update',
    'db.delete',
    'drizzle',
    'hono',
    'bullmq',
    'queue.add',
    'outboxevents',
    'sendmail',
    'sendsms',
    'sendwhatsapp',
    'loyalty',
    'reward',
    'coupon',
    'discount',
    'memory lane',
    'personalisation',
    'utilisation-aware',
    'process.env',
    'provider_transport.call',
  ].forEach(forbidden => {
    it(`does not couple the cohort guard to ${forbidden}`, () => expect(runtimeSource).not.toContain(forbidden));
  });
});

describe('bounded cohort cap', () => {
  [-100, -10, -3, -2, -1, 0, 4, 5, 6, 10, 20, 50, 100, 1.1, 1.5, 2.2, 2.9, 3.1, Number.NaN, Number.POSITIVE_INFINITY].forEach(cap => {
    it(`rejects out-of-bounds cohort cap ${String(cap)}`, () => {
      expect(() => new ControlledPilotCohort(cap)).toThrow('pilot_cohort_cap_out_of_bounds');
    });
  });

  [1, 2, 3].forEach(cap => {
    it(`accepts bounded cohort cap ${cap}`, () => {
      const cohort = new ControlledPilotCohort(cap);
      for (let index = 0; index < cap; index += 1) {
        cohort.add(validIdentities[index], 'synthetic', 'synthetic_internal');
      }
      expect(cohort.status().cohort_size).toBe(cap);
      expect(() => cohort.add(validIdentities[cap], 'synthetic', 'synthetic_internal')).toThrow('pilot_cohort_cap_reached');
    });
  });

  [1, 2, 3].forEach(cap => {
    it(`deduplicates before enforcing cap ${cap}`, () => {
      const cohort = new ControlledPilotCohort(cap);
      const first = cohort.add('Pilot@Example.test', 'synthetic', 'synthetic_internal');
      const replay = cohort.add('  pilot@example.test  ', 'synthetic', 'synthetic_internal');
      expect(replay).toBe(first);
      expect(cohort.status().cohort_size).toBe(1);
    });
  });
});

describe('secure identity provisioning', () => {
  const allowed: Array<[Extract<PilotProvisioningSource, 'synthetic' | 'root_only' | 'admin'>, 'synthetic_internal' | 'root_only' | 'admin']> = [
    ['synthetic', 'synthetic_internal'],
    ['root_only', 'root_only'],
    ['admin', 'admin'],
  ];
  allowed.forEach(([source, actor]) => {
    it(`accepts ${source} provisioning`, () => {
      const record = new ControlledPilotCohort().add('pilot@example.test', source, actor);
      expect(record.status).toBe('active');
      expect(record.created_by_actor_classification).toBe(actor);
    });
  });

  (['chat', 'public_form', 'checkout', 'support', 'legacy'] as PilotProvisioningSource[]).forEach(source => {
    it(`rejects unsafe ${source} provisioning`, () => {
      expect(() => provisionPilotIdentity('pilot@example.test', source)).toThrow('unsafe_pilot_provisioning_source');
    });
  });

  validIdentities.forEach(identity => {
    it(`normalizes and hashes ${identity}`, () => {
      const canonical = hashPilotIdentity(identity);
      expect(hashPilotIdentity(`  ${identity.toUpperCase()}  `)).toBe(canonical);
      expect(canonical).toMatch(/^identity_[a-f0-9]{24}$/);
    });
  });

  validIdentities.slice(0, 20).forEach(identity => {
    it(`masks and never stores raw identity ${identity.split('@')[0]}`, () => {
      const record = new ControlledPilotCohort().add(identity, 'synthetic', 'synthetic_internal');
      expect(record.masked_identity).toMatch(/^pi\*\*\*@ex\*\*\*$/);
      expect(JSON.stringify(record)).not.toContain(identity);
      expect(Object.keys(record).sort()).toEqual([
        'configured_at',
        'created_by_actor_classification',
        'identity_hash',
        'masked_identity',
        'pilot_ring_name',
        'ring',
        'source',
        'status',
      ]);
    });
  });

  [
    ['a@example.test', 'a***@ex***'],
    ['ab@example.test', 'ab***@ex***'],
    ['pilot@example.test', 'pi***@ex***'],
    ['ROOT@INTERNAL.TEST', 'RO***@IN***'],
    ['xy@z.test', 'xy***@z.***'],
    ['123456789', '123***'],
    ['abcdef', 'abc***'],
    ['x', 'x***'],
    ['xy', 'xy***'],
    ['xyz', 'xyz***'],
    ['synthetic-01', 'syn***'],
    ['synthetic-02', 'syn***'],
    ['admin-pilot', 'adm***'],
    ['root-pilot', 'roo***'],
    ['internal-pilot', 'int***'],
    ['pilot+one@example.test', 'pi***@ex***'],
    ['pilot+two@example.test', 'pi***@ex***'],
    ['one@internal.test', 'on***@in***'],
    ['two@internal.test', 'tw***@in***'],
    ['', 'unknown'],
  ].forEach(([identity, expected]) => {
    it(`masks identity shape ${identity || 'empty'}`, () => expect(maskPilotIdentity(identity)).toBe(expected));
  });

  validHashes.forEach(hash => {
    it(`accepts valid pre-hashed allowlist entry ${hash.slice(-4)}`, () => {
      const [record] = parsePilotAllowlist(hash, '2026-07-15T00:00:00.000Z');
      expect(record.identity_hash).toBe(hash);
      expect(record.masked_identity).toBe('configured-allowlist-entry');
      expect(record.ring).toBe('ring_1_allowlisted_verified_pilot');
    });
  });

  [
    '',
    'pilot@example.test',
    'identity_',
    'identity_0',
    'identity_short',
    'identity_00000000000000000000000',
    'identity_0000000000000000000000000',
    'identity_gggggggggggggggggggggggg',
    'IDENTITY_000000000000000000000001',
    'hash_000000000000000000000001',
    'sha256:000000000000000000000001',
    ' identity_000000000000000000000001 extra',
    'identity-000000000000000000000001',
    'identity_00000000000000000000000z',
    'identity_00000000000000000000001/',
    'identity_00000000000000000000001=',
    'identity_00000000000000000000001+',
    '../identity_000000000000000000000001',
    '${identity_hash}',
    'null',
    'undefined',
    'true',
    'false',
    '0',
    '[]',
  ].forEach(value => {
    it(`rejects non-hash allowlist input ${value || 'empty'}`, () => expect(parsePilotAllowlist(value)).toHaveLength(0));
  });
});

describe('Ring 1 save guard', () => {
  const rejectionCases: Array<[string, PilotSaveInput, string]> = [
    ['disabled pilot', { ...base, pilot_save_enabled: false }, 'pilot_save_is_disabled'],
    ['Ring 2', { ...base, identity_ring: 'ring_2_public_read_only' }, 'identity_ring_not_write_enabled'],
    ['Ring 3', { ...base, identity_ring: 'ring_3_blocked_external' }, 'identity_ring_not_write_enabled'],
    ['unverified identity', { ...base, identity_verified: false }, 'pilot_identity_verification_required'],
    ['non-allowlisted identity', { ...base, identity_allowlisted: false }, 'pilot_identity_allowlist_required'],
    ['anonymous', { ...base, identity_classification: 'anonymous' }, 'identity_classification_not_allowed'],
    ['checkout-only', { ...base, identity_classification: 'checkout_contact_only' }, 'identity_classification_not_allowed'],
    ['support-only', { ...base, identity_classification: 'support_only' }, 'identity_classification_not_allowed'],
    ['legacy imported', { ...base, identity_classification: 'legacy_imported' }, 'identity_classification_not_allowed'],
    ['unknown imported', { ...base, identity_classification: 'unknown_imported' }, 'identity_classification_not_allowed'],
    ['missing purpose', { ...base, purpose_key: '' }, 'canonical_purpose_and_channel_required'],
    ['missing channel', { ...base, channel_key: '' }, 'canonical_purpose_and_channel_required'],
    ['missing correlation', { ...base, correlation_id: '' }, 'correlation_id_required'],
    ['missing idempotency', { ...base, idempotency_key: '' }, 'idempotency_key_required'],
    ['missing copy', { ...base, copy_version: '' }, 'copy_version_required'],
    ['missing source', { ...base, source_surface: '' }, 'preference_centre_source_required'],
    ['wrong source', { ...base, source_surface: 'checkout' }, 'preference_centre_source_required'],
    ['public source', { ...base, source_surface: 'public_form' }, 'preference_centre_source_required'],
    ['support source', { ...base, source_surface: 'support' }, 'preference_centre_source_required'],
    ['missing audit', { ...base, audit_required: false }, 'audit_required'],
    ['provider live', { ...base, provider_live_sends: true }, 'provider_live_sends_must_remain_disabled'],
    ['provider transport', { ...base, provider_transport_requested: true }, 'provider_transport_not_allowed'],
    ['queue send', { ...base, queue_send_requested: true }, 'queue_send_not_allowed'],
    ['campaign', { ...base, campaign_id: 'campaign-1' }, 'campaign_or_newsletter_not_allowed'],
    ['bulk campaign', { ...base, campaign_id: 'bulk-list-1' }, 'campaign_or_newsletter_not_allowed'],
    ['newsletter', { ...base, newsletter_id: 'newsletter-1' }, 'campaign_or_newsletter_not_allowed'],
    ['side effect', { ...base, side_effect_requested: true }, 'unrelated_side_effect_not_allowed'],
    ['invalid state', { ...base, requested_state: 'unknown' } as unknown as PilotSaveInput, 'explicit_state_required'],
  ];
  rejectionCases.forEach(([name, input, reason]) => {
    it(`rejects ${name}`, () => {
      const result = authorizePilotPreferenceSave(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasons).toContain(reason);
    });
  });

  const forbiddenClassifications: PilotIdentityClassification[] = [
    'anonymous',
    'checkout_contact_only',
    'support_only',
    'legacy_imported',
    'unknown_imported',
  ];
  const rings = [
    'ring_0_internal_uat',
    'ring_1_allowlisted_verified_pilot',
    'ring_2_public_read_only',
    'ring_3_blocked_external',
  ] as const;
  forbiddenClassifications.forEach(identity_classification => {
    rings.forEach(identity_ring => {
      [true, false].forEach(identity_verified => {
        [true, false].forEach(identity_allowlisted => {
          it(`blocks ${identity_classification} in ${identity_ring}, verified=${identity_verified}, allowlisted=${identity_allowlisted}`, () => {
            expect(authorizePilotPreferenceSave({
              ...base,
              identity_classification,
              identity_ring,
              identity_verified,
              identity_allowlisted,
            }).ok).toBe(false);
          });
        });
      });
    });
  });

  (['ring_2_public_read_only', 'ring_3_blocked_external'] as const).forEach(identity_ring => {
    (['verified_account', 'synthetic_internal'] as const).forEach(identity_classification => {
      [true, false].forEach(identity_verified => {
        [true, false].forEach(identity_allowlisted => {
          it(`blocks ${identity_ring} ${identity_classification}, verified=${identity_verified}, allowlisted=${identity_allowlisted}`, () => {
            expect(authorizePilotPreferenceSave({
              ...base,
              identity_ring,
              identity_classification,
              identity_verified,
              identity_allowlisted,
            }).ok).toBe(false);
          });
        });
      });
    });
  });

  (['verified_account', 'synthetic_internal'] as const).forEach(identity_classification => {
    (['granted', 'withdrawn'] as const).forEach(requested_state => {
      ['email', 'sms', 'whatsapp'].forEach(channel_key => {
        it(`authorizes controlled ${requested_state} for ${identity_classification} on ${channel_key}`, () => {
          expect(authorizePilotPreferenceSave({ ...base, identity_classification, requested_state, channel_key })).toEqual({ ok: true });
        });
      });
    });
  });

  Array.from({ length: 20 }, (_, index) => index + 1).forEach(index => {
    it(`is deterministic for idempotent guard replay ${index}`, () => {
      const input = { ...base, correlation_id: `corr-${index}`, idempotency_key: `idem-${index}` };
      expect(authorizePilotPreferenceSave(input)).toEqual(authorizePilotPreferenceSave(input));
      expect(authorizePilotPreferenceSave(input)).toEqual({ ok: true });
    });
  });
});

describe('operator monitoring and rollback control', () => {
  for (let saves = 0; saves < 5; saves += 1) {
    for (let withdrawals = 0; withdrawals < 5; withdrawals += 1) {
      it(`reports ${saves} saves and ${withdrawals} withdrawals`, () => {
        const cohort = new ControlledPilotCohort();
        for (let index = 0; index < saves; index += 1) cohort.recordSave(`2026-07-15T00:00:${String(index).padStart(2, '0')}.000Z`);
        for (let index = 0; index < withdrawals; index += 1) cohort.recordWithdrawal(`2026-07-15T00:01:${String(index).padStart(2, '0')}.000Z`);
        expect(cohort.status().save_success_count).toBe(saves);
        expect(cohort.status().withdrawal_count).toBe(withdrawals);
        expect(cohort.status().provider_sends_enabled).toBe(false);
      });
    }
  }

  for (let publicBlocks = 0; publicBlocks < 5; publicBlocks += 1) {
    for (let ring3Blocks = 0; ring3Blocks < 5; ring3Blocks += 1) {
      it(`reports ${publicBlocks} public and ${ring3Blocks} Ring 3 blocks`, () => {
        const cohort = new ControlledPilotCohort();
        for (let index = 0; index < publicBlocks; index += 1) cohort.recordBlockedPublic();
        for (let index = 0; index < ring3Blocks; index += 1) cohort.recordBlockedRing3();
        expect(cohort.status().blocked_public_attempt_count).toBe(publicBlocks);
        expect(cohort.status().blocked_ring3_attempt_count).toBe(ring3Blocks);
      });
    }
  }

  (['unknown', 'active', 'elapsed'] as const).forEach(cooldown => {
    it(`reports ${cooldown} cooldown without enabling sends`, () => {
      const status = new ControlledPilotCohort().status(cooldown);
      expect(status.email_cooldown_status).toBe(cooldown);
      expect(status.provider_sends_enabled).toBe(false);
    });
  });

  validIdentities.slice(0, 12).forEach((identity, index) => {
    it(`records masked cohort activity timestamp ${index + 1}`, () => {
      const now = `2026-07-15T12:${String(index).padStart(2, '0')}:00.000Z`;
      const cohort = new ControlledPilotCohort();
      const record = cohort.add(identity, 'synthetic', 'synthetic_internal', now);
      expect(cohort.status().last_event_at).toBe(now);
      expect(cohort.hasActive(record.identity_hash)).toBe(true);
    });
  });

  validIdentities.slice(0, 10).forEach((identity, index) => {
    it(`disables active identity ${index + 1} fail-closed`, () => {
      const cohort = new ControlledPilotCohort();
      const record = cohort.add(identity, 'synthetic', 'synthetic_internal');
      cohort.disable(`2026-07-15T13:${String(index).padStart(2, '0')}:00.000Z`);
      expect(cohort.hasActive(record.identity_hash)).toBe(false);
      expect(cohort.status().pilot_ring_enabled).toBe(false);
      expect(cohort.status().provider_sends_enabled).toBe(false);
    });
  });

  [0, 1, 2, 3, 10, 100].forEach(allowlist_count => {
    it(`keeps Ring 2 read-only and provider sends disabled for allowlist count ${allowlist_count}`, () => {
      const status = buildPilotRingStatus({ save_enabled: true, allowlist_count, cooldown_safe_to_attempt: false });
      expect(status.ring_2).toBe('public_read_only');
      expect(status.provider_sends_enabled).toBe(false);
      expect(status.cooldown_safe_to_attempt).toBe(false);
    });
  });
});
