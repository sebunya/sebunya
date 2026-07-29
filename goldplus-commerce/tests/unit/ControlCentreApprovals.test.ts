import { describe, it, expect, beforeEach } from 'vitest';
import {
  ApproveModuleActivationUseCase,
  ListModuleApprovalsUseCase,
  RevokeModuleActivationUseCase,
  approvalGatedModuleKeys,
  type IModuleApprovalRepository,
  type ModuleApprovalRecord,
} from '../../apps/api/src/application/use-cases/control-centre/ModuleActivationApprovalUseCases';

/**
 * In-memory ledger that mirrors the database invariants migration 0049 enforces,
 * so the use case is tested against the same rules production has.
 */
class FakeApprovalRepo implements IModuleApprovalRepository {
  records: ModuleApprovalRecord[] = [];
  private seq = 0;

  async list() {
    return [...this.records];
  }
  async findLive(moduleKey: string) {
    return this.records.find((r) => r.moduleKey === moduleKey && !r.revokedAt) ?? null;
  }
  async approve(input: {
    moduleKey: string;
    approvedBy: string;
    reason: string;
    approvalReference: string;
    traceId: string;
  }) {
    // The partial unique index makes a second live approval impossible.
    if (await this.findLive(input.moduleKey)) throw new Error('duplicate live approval');
    const record: ModuleApprovalRecord = {
      id: `approval-${++this.seq}`,
      moduleKey: input.moduleKey,
      approvedBy: input.approvedBy,
      approvedAt: new Date().toISOString(),
      reason: input.reason,
      approvalReference: input.approvalReference,
      revokedBy: null,
      revokedAt: null,
      revocationReason: null,
      traceId: input.traceId,
    };
    this.records.push(record);
    return record;
  }
  async revoke(input: { moduleKey: string; revokedBy: string; revocationReason: string }) {
    const live = await this.findLive(input.moduleKey);
    if (!live) return null;
    live.revokedBy = input.revokedBy;
    live.revokedAt = new Date().toISOString();
    live.revocationReason = input.revocationReason;
    return live;
  }
}

class FakeAudit {
  entries: { action: string; entityId: string; actorId: string | null }[] = [];
  async execute(input: { action: string; entityId: string; actorId: string | null }) {
    this.entries.push(input);
    return { ok: true as const, id: 'audit-1' };
  }
}

const ACTOR = '11111111-1111-4111-8111-111111111111';
const valid = {
  moduleKey: 'loyalty',
  actorId: ACTOR,
  reason: 'Programme policy and liability model approved',
  approvalReference: 'DEC-2026-014',
  traceId: 'trace-1',
};

let repo: FakeApprovalRepo;
let audit: FakeAudit;
let approve: ApproveModuleActivationUseCase;
let revoke: RevokeModuleActivationUseCase;

beforeEach(() => {
  repo = new FakeApprovalRepo();
  audit = new FakeAudit();
  approve = new ApproveModuleActivationUseCase(repo, audit as never);
  revoke = new RevokeModuleActivationUseCase(repo, audit as never);
});

describe('module activation approvals', () => {
  it('gates only the modules whose registry policy is OPERATOR_APPROVAL', () => {
    const keys = approvalGatedModuleKeys();
    expect(keys).toContain('loyalty');
    expect(keys).toContain('automation');
    expect(keys).toContain('pricing');
    // Products activates automatically; an approval row for it would imply a
    // control that does not exist.
    expect(keys).not.toContain('products');
    expect(keys).not.toContain('legal');
  });

  it('records an approval with actor, reason and reference', async () => {
    const result = await approve.execute(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.moduleKey).toBe('loyalty');
    expect(result.record.approvedBy).toBe(ACTOR);
    expect(result.record.reason).toBe(valid.reason);
    expect(result.record.approvalReference).toBe('DEC-2026-014');
    expect(result.record.revokedAt).toBeNull();
  });

  it('audits every approval with the module and reference', async () => {
    await approve.execute(valid);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0].action).toBe('MODULE_ACTIVATION_APPROVED');
    expect(audit.entries[0].actorId).toBe(ACTOR);
  });

  it('refuses a module the registry does not gate by approval', async () => {
    const result = await approve.execute({ ...valid, moduleKey: 'products' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MODULE_NOT_APPROVAL_GATED');
    expect(repo.records).toHaveLength(0);
  });

  it('refuses an unknown module', async () => {
    const result = await approve.execute({ ...valid, moduleKey: 'not-a-module' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_MODULE');
  });

  it.each([
    ['reason', { reason: '   ' }],
    ['approvalReference', { approvalReference: '' }],
  ])('refuses a blank %s — an approval without one is not auditable', async (_label, patch) => {
    const result = await approve.execute({ ...valid, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BAD_INPUT');
    expect(audit.entries).toHaveLength(0);
  });

  it('refuses a second live approval for the same module', async () => {
    await approve.execute(valid);
    const second = await approve.execute({ ...valid, approvalReference: 'DEC-2026-015' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('ALREADY_APPROVED');
    expect(repo.records).toHaveLength(1);
  });

  it('revokes a live approval and audits it', async () => {
    await approve.execute(valid);
    const result = await revoke.execute({
      moduleKey: 'loyalty',
      actorId: ACTOR,
      revocationReason: 'Policy withdrawn pending finance review',
      traceId: 'trace-2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.revokedAt).not.toBeNull();
    expect(audit.entries.map((e) => e.action)).toEqual([
      'MODULE_ACTIVATION_APPROVED',
      'MODULE_ACTIVATION_REVOKED',
    ]);
  });

  it('refuses a revocation with no reason', async () => {
    await approve.execute(valid);
    const result = await revoke.execute({
      moduleKey: 'loyalty',
      actorId: ACTOR,
      revocationReason: '  ',
      traceId: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BAD_INPUT');
  });

  it('refuses revoking a module with no live approval', async () => {
    const result = await revoke.execute({
      moduleKey: 'loyalty',
      actorId: ACTOR,
      revocationReason: 'nothing to revoke',
      traceId: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_APPROVED');
  });

  it('allows re-approval after revocation', async () => {
    await approve.execute(valid);
    await revoke.execute({
      moduleKey: 'loyalty',
      actorId: ACTOR,
      revocationReason: 'withdrawn',
      traceId: 't',
    });
    const again = await approve.execute({ ...valid, approvalReference: 'DEC-2026-020' });
    expect(again.ok).toBe(true);
    expect(repo.records).toHaveLength(2);
  });

  it('lists approvals alongside the gated module set', async () => {
    await approve.execute(valid);
    const listed = await new ListModuleApprovalsUseCase(repo).execute();
    expect(listed.approvals).toHaveLength(1);
    expect(listed.approvalGatedModules).toEqual(approvalGatedModuleKeys());
  });
});
