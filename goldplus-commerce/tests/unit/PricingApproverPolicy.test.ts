import { describe, expect, it, vi } from 'vitest';
import { requiresDistinctApprover, DEFAULT_PROMOTION_APPROVAL_POLICY } from '../../apps/api/src/domain/pricing/Pricing';
import { PricingGovernanceUseCase } from '../../apps/api/src/application/use-cases/pricing/PricingGovernanceUseCase';

const policy = { percentBpsThreshold: 2000, fixedUgxThreshold: 100_000 };

const versionRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'v1',
  definitionId: 'd1',
  versionNumber: 1,
  status: 'APPROVED',
  createdBy: 'creator-user',
  conditions: [],
  benefits: [{ type: 'PERCENTAGE_OFF', value: 3000 }], // 30% > 20% threshold => high-value
  exclusions: [],
  schedule: { startsAt: new Date('2026-07-01T00:00:00Z'), endsAt: new Date('2026-08-01T00:00:00Z') },
  usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 },
  priority: 10,
  stackable: false,
  couponCode: null,
  priceFloorUgx: 0,
  ...overrides,
});

const makeUseCase = (version: ReturnType<typeof versionRecord>) => {
  const repo = {
    findVersion: vi.fn().mockResolvedValue(version),
    transitionVersion: vi.fn().mockResolvedValue({ definition: { id: 'd1', status: 'ACTIVE' }, version }),
  } as any;
  const audit = { execute: vi.fn().mockResolvedValue(undefined) } as any;
  return { uc: new PricingGovernanceUseCase(repo, audit, policy), repo, audit };
};

const at = new Date('2026-07-15T00:00:00Z'); // inside the activation window

describe('U1 AC10 — distinct approver above a configured threshold', () => {
  it('requiresDistinctApprover flags high-value discounts only', () => {
    expect(requiresDistinctApprover([{ type: 'PERCENTAGE_OFF', value: 3000 }], policy)).toBe(true);
    expect(requiresDistinctApprover([{ type: 'PERCENTAGE_OFF', value: 1000 }], policy)).toBe(false);
    expect(requiresDistinctApprover([{ type: 'FIXED_AMOUNT_OFF', value: 150_000 }], policy)).toBe(true);
    expect(requiresDistinctApprover([{ type: 'FIXED_AMOUNT_OFF', value: 50_000 }], policy)).toBe(false);
    expect(requiresDistinctApprover([{ type: 'FREE_SHIPPING', value: 0 }], policy)).toBe(false);
    expect(DEFAULT_PROMOTION_APPROVAL_POLICY.percentBpsThreshold).toBe(2000);
  });

  it('blocks activation of a high-value promotion by its own creator', async () => {
    const { uc, repo } = makeUseCase(versionRecord());
    await expect(
      uc.transition({ definitionId: 'd1', versionId: 'v1', expectedRevision: 1, to: 'ACTIVE', actorId: 'creator-user', reason: 'launch', now: at }),
    ).rejects.toMatchObject({ code: 'APPROVER_MUST_DIFFER' });
    expect(repo.transitionVersion).not.toHaveBeenCalled(); // nothing persisted
  });

  it('allows a distinct approver to activate a high-value promotion and audits the threshold', async () => {
    const { uc, repo, audit } = makeUseCase(versionRecord());
    await uc.transition({ definitionId: 'd1', versionId: 'v1', expectedRevision: 1, to: 'ACTIVE', actorId: 'approver-user', reason: 'launch', now: at });
    expect(repo.transitionVersion).toHaveBeenCalled();
    const auditCall = audit.execute.mock.calls[0][0];
    expect(auditCall.newState.approval.distinctApproverRequired).toBe(true);
    expect(auditCall.newState.approval.thresholdApplied.percentBpsThreshold).toBe(2000);
  });

  it('allows the creator to activate a low-value promotion (no distinct approver required)', async () => {
    const { uc, repo } = makeUseCase(versionRecord({ benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }] }));
    await uc.transition({ definitionId: 'd1', versionId: 'v1', expectedRevision: 1, to: 'ACTIVE', actorId: 'creator-user', reason: 'launch', now: at });
    expect(repo.transitionVersion).toHaveBeenCalled();
  });
});
