import { describe, it, expect } from 'vitest';
import { CreateAuditLogUseCase } from '../../apps/api/src/application/use-cases/audit/CreateAuditLogUseCase';
import { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';
import { AuditLogEntity } from '../../apps/api/src/domain/audit/AuditLogEntity';

function makeFake(): IAuditRepository & { saved: AuditLogEntity[] } {
  const saved: AuditLogEntity[] = [];
  return {
    saved,
    save: async (log) => {
      saved.push(log);
    },
    findAll: async () => saved,
    findByEntity: async (_entity, entityId) => saved.filter((l) => l.entityId === entityId),
  };
}

describe('CreateAuditLogUseCase', () => {
  const valid = {
    actorId: '00000000-0000-0000-0000-000000000001',
    action: 'DEALER_APPROVED',
    entity: 'dealer',
    entityId: '00000000-0000-0000-0000-000000000002',
    previousState: { status: 'pending' },
    newState: { status: 'active' },
  };

  it('writes a row for a complete input', async () => {
    const repo = makeFake();
    const uc = new CreateAuditLogUseCase(repo);
    const r = await uc.execute(valid);
    expect(r.ok).toBe(true);
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0].action).toBe('DEALER_APPROVED');
    expect(repo.saved[0].actorId).toBe(valid.actorId);
    expect(repo.saved[0].previousState).toEqual({ status: 'pending' });
    expect(repo.saved[0].newState).toEqual({ status: 'active' });
    expect(repo.saved[0].createdAt).toBeInstanceOf(Date);
    expect(repo.saved[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allows null actorId for system actions', async () => {
    const repo = makeFake();
    const uc = new CreateAuditLogUseCase(repo);
    const r = await uc.execute({ ...valid, actorId: null, action: 'PAYMENT_SUCCESS_WEBHOOK' });
    expect(r.ok).toBe(true);
    expect(repo.saved[0].actorId).toBeNull();
  });

  it('rejects empty action', async () => {
    const repo = makeFake();
    const uc = new CreateAuditLogUseCase(repo);
    const r = await uc.execute({ ...valid, action: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_INPUT');
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects empty entity', async () => {
    const repo = makeFake();
    const uc = new CreateAuditLogUseCase(repo);
    const r = await uc.execute({ ...valid, entity: '' });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects empty entityId', async () => {
    const repo = makeFake();
    const uc = new CreateAuditLogUseCase(repo);
    const r = await uc.execute({ ...valid, entityId: '' });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('rejects over-long action', async () => {
    const repo = makeFake();
    const uc = new CreateAuditLogUseCase(repo);
    const r = await uc.execute({ ...valid, action: 'A'.repeat(101) });
    expect(r.ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('defaults state snapshots to null when omitted', async () => {
    const repo = makeFake();
    const uc = new CreateAuditLogUseCase(repo);
    await uc.execute({
      actorId: valid.actorId,
      action: 'ADMIN_LOGIN',
      entity: 'user',
      entityId: valid.actorId,
    });
    expect(repo.saved[0].previousState).toBeNull();
    expect(repo.saved[0].newState).toBeNull();
  });
});
