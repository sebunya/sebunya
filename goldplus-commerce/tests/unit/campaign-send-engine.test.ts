import { describe, expect, it } from 'vitest';
import {
  CampaignSendEngineUseCase,
  FREQUENCY_CAP_DAYS,
  isQuietHours,
  SendGateReads,
  SendRunSink,
} from '../../apps/api/src/application/use-cases/campaigns/CampaignSendEngineUseCase';

/**
 * Send-engine invariants (the safety wave): LIVE is unreachable, consent is
 * fail-closed, every subject gets exactly one decision, gates apply in order
 * (identity → consent → suppression → frequency), and quiet hours are computed
 * for Africa/Kampala.
 */

const gates = (over: Partial<SendGateReads> = {}): SendGateReads => ({
  advertisingGrantedUserIds: async () => new Set(),
  suppressedUserIds: async () => new Set(),
  recentlyEligibleSubjects: async () => new Set(),
  ...over,
});

const sinkCapture = () => {
  const captured: any[] = [];
  const sink: SendRunSink = { persist: async (run) => { captured.push(run); return { runId: 'run-1' }; } };
  return { sink, captured };
};

const APPROVED = { id: 'c1', status: 'APPROVED', channel: 'email' };
const NOON_UTC = () => new Date('2026-08-03T12:00:00Z'); // 15:00 Kampala — not quiet

describe('CampaignSendEngineUseCase', () => {
  it('refuses anything but DRY_RUN — LIVE is unreachable', async () => {
    const { sink } = sinkCapture();
    const engine = new CampaignSendEngineUseCase(gates(), sink, NOON_UTC);
    for (const mode of ['LIVE', 'SEND', 'live', '']) {
      const outcome = await engine.dryRun({ campaign: APPROVED, mode, audience: [{ subjectRef: 's1', ownerKind: 'USER', ownerId: 'u1' }], actorId: 'a' });
      expect(outcome).toMatchObject({ ok: false, code: 'LIVE_FORBIDDEN' });
    }
  });

  it('requires an APPROVED campaign and a non-empty audience', async () => {
    const { sink } = sinkCapture();
    const engine = new CampaignSendEngineUseCase(gates(), sink, NOON_UTC);
    expect(await engine.dryRun({ campaign: { ...APPROVED, status: 'DRAFT' }, mode: 'DRY_RUN', audience: [{ subjectRef: 's', ownerKind: null, ownerId: null }], actorId: null }))
      .toMatchObject({ ok: false, code: 'NOT_APPROVED' });
    expect(await engine.dryRun({ campaign: APPROVED, mode: 'DRY_RUN', audience: [], actorId: null }))
      .toMatchObject({ ok: false, code: 'EMPTY_AUDIENCE' });
  });

  it('applies the gates in order with fail-closed consent, one decision per subject', async () => {
    const { sink, captured } = sinkCapture();
    const engine = new CampaignSendEngineUseCase(
      gates({
        advertisingGrantedUserIds: async () => new Set(['u-consented', 'u-suppressed', 'u-capped']),
        suppressedUserIds: async () => new Set(['u-suppressed']),
        recentlyEligibleSubjects: async () => new Set(['cart-capped']),
      }),
      sink,
      NOON_UTC,
    );
    const outcome = await engine.dryRun({
      campaign: APPROVED,
      mode: 'DRY_RUN',
      audience: [
        { subjectRef: 'cart-guest', ownerKind: 'GUEST', ownerId: 'anon' },
        { subjectRef: 'cart-noconsent', ownerKind: 'USER', ownerId: 'u-silent' }, // no grant on record → fail closed
        { subjectRef: 'cart-suppressed', ownerKind: 'USER', ownerId: 'u-suppressed' },
        { subjectRef: 'cart-capped', ownerKind: 'USER', ownerId: 'u-capped' },
        { subjectRef: 'cart-ok', ownerKind: 'USER', ownerId: 'u-consented' },
      ],
      actorId: 'admin-1',
    });
    expect(outcome).toMatchObject({
      ok: true,
      counts: { candidates: 5, eligible: 1, noIdentity: 1, noConsent: 1, suppressed: 1, frequency: 1 },
    });
    const decisions = Object.fromEntries(captured[0].decisions.map((d: any) => [d.subjectRef, d.decision]));
    expect(decisions).toEqual({
      'cart-guest': 'NO_IDENTITY',
      'cart-noconsent': 'NO_CONSENT',
      'cart-suppressed': 'SUPPRESSED',
      'cart-capped': 'FREQUENCY_CAPPED',
      'cart-ok': 'ELIGIBLE',
    });
    expect(captured[0].decisions).toHaveLength(5);
  });

  it('computes Kampala quiet hours (21:00–08:00 local, UTC+3)', () => {
    expect(isQuietHours(new Date('2026-08-03T18:30:00Z'))).toBe(true); // 21:30 EAT
    expect(isQuietHours(new Date('2026-08-03T04:00:00Z'))).toBe(true); // 07:00 EAT
    expect(isQuietHours(new Date('2026-08-03T05:00:00Z'))).toBe(false); // 08:00 EAT
    expect(isQuietHours(new Date('2026-08-03T12:00:00Z'))).toBe(false); // 15:00 EAT
    expect(FREQUENCY_CAP_DAYS).toBe(7);
  });
});
