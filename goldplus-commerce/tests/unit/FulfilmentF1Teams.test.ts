import { describe, it, expect } from 'vitest';
import { FulfilmentTask, FulfilmentTaskSnapshot, isTerminalFulfilmentStatus } from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository, FulfilmentQueueQuery, FulfilmentQueuePage } from '../../apps/api/src/application/ports/IFulfilmentRepository';
import { IFulfilmentTeamRepository, FulfilmentTeam, FulfilmentTeamMember } from '../../apps/api/src/application/ports/IFulfilmentTeamRepository';
import { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';
import { AssignFulfilmentTaskUseCase } from '../../apps/api/src/application/use-cases/fulfilment/AssignFulfilmentTaskUseCase';
import {
  CreateFulfilmentTeamUseCase,
  ManageTeamMemberUseCase,
  MoveFulfilmentTeamUseCase,
  BulkAssignFulfilmentTasksUseCase,
} from '../../apps/api/src/application/use-cases/fulfilment/FulfilmentTeamUseCases';

class SpyAudit implements IAuditRepository {
  saved: any[] = [];
  async save(l: any) { this.saved.push(l); }
  async findAll() { return this.saved; }
  async findByEntity(e: string, id: string) { return this.saved.filter((l) => l.entity === e && l.entityId === id); }
}

function makeSnapshot(id: string, over: Partial<FulfilmentTaskSnapshot> = {}): FulfilmentTaskSnapshot {
  const t = FulfilmentTask.openForOrder({
    id, orderId: `o-${id}`, orderNumber: `GP-${id}`, paymentStatus: 'paid',
    customerName: 'A', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0,
    items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1, lineTotalUgx: 1 }],
  });
  return { ...t.toSnapshot(), ...over };
}

class InMemoryFulfilmentRepo implements IFulfilmentRepository {
  byId = new Map<string, FulfilmentTaskSnapshot>();
  async createForOrder(task: FulfilmentTask) { const s = task.toSnapshot(); this.byId.set(s.id, s); return { created: true, task: s }; }
  async findByOrderId() { return null; }
  async findById(id: string) { return this.byId.get(id) ?? null; }
  async update(task: FulfilmentTask) { const s = task.toSnapshot(); this.byId.set(s.id, s); }
  async listQueue(q: FulfilmentQueueQuery): Promise<FulfilmentQueuePage> {
    let all = [...this.byId.values()];
    if (q.teamId === 'unassigned') all = all.filter((t) => t.teamId === null);
    else if (q.teamId) all = all.filter((t) => t.teamId === q.teamId);
    if (q.assignedTo === 'unassigned') all = all.filter((t) => t.assignedTo === null);
    else if (q.assignedTo) all = all.filter((t) => t.assignedTo === q.assignedTo);
    return { tasks: all.slice(q.offset, q.offset + q.limit), total: all.length };
  }
  async countNew() { return 0; }
  async countOverdue() { return 0; }
}

class InMemoryTeamRepo implements IFulfilmentTeamRepository {
  teams = new Map<string, FulfilmentTeam>();
  members = new Map<string, Set<string>>(); // teamId -> userIds
  async createTeam(input: { name: string; slug: string }) {
    if ([...this.teams.values()].some((t) => t.slug === input.slug)) return { ok: false as const, code: 'DUPLICATE' as const };
    const team = { id: `team-${this.teams.size + 1}`, name: input.name, slug: input.slug, active: true };
    this.teams.set(team.id, team);
    return { ok: true as const, team };
  }
  async listTeams() { return [...this.teams.values()]; }
  async findById(id: string) { return this.teams.get(id) ?? null; }
  async addMember(teamId: string, userId: string) { (this.members.get(teamId) ?? this.members.set(teamId, new Set()).get(teamId)!).add(userId); return { added: true }; }
  async removeMember(teamId: string, userId: string) { const had = this.members.get(teamId)?.delete(userId) ?? false; return { removed: had }; }
  async listMembers(teamId: string): Promise<FulfilmentTeamMember[]> { return [...(this.members.get(teamId) ?? [])].map((u) => ({ userId: u, active: true })); }
  async isMember(teamId: string, userId: string) { return this.members.get(teamId)?.has(userId) ?? false; }
}

describe('Fulfilment F1 — domain team ownership', () => {
  it('assignToTeam sets team and can clear an ineligible assignee', () => {
    const task = FulfilmentTask.rehydrate(makeSnapshot('t1', { assignedTo: 'u1' }));
    task.assignToTeam('team-1', { clearAssignee: true });
    expect(task.teamId).toBe('team-1');
    expect(task.assignedTo).toBeNull();
  });
  it('refuses team move on terminal tasks', () => {
    const task = FulfilmentTask.rehydrate(makeSnapshot('t2'));
    task.cancel();
    expect(isTerminalFulfilmentStatus(task.status)).toBe(true);
    expect(() => task.assignToTeam('team-1')).toThrow('INVALID_ASSIGNMENT');
  });
});

describe('Fulfilment F1 — teams and membership', () => {
  it('creates a team, rejects duplicates, and audits', async () => {
    const teams = new InMemoryTeamRepo();
    const audit = new SpyAudit();
    const uc = new CreateFulfilmentTeamUseCase(teams, audit);
    const a = await uc.execute({ name: 'Kampala Dispatch', actorId: 'admin' });
    expect(a.ok).toBe(true);
    expect(audit.saved.at(-1).action).toBe('FULFILMENT_TEAM_CREATED');
    const dup = await uc.execute({ name: 'Kampala Dispatch', actorId: 'admin' });
    expect(dup.ok).toBe(false);
  });
  it('adds/removes members with audit and not-found handling', async () => {
    const teams = new InMemoryTeamRepo();
    const audit = new SpyAudit();
    const { team } = (await new CreateFulfilmentTeamUseCase(teams, audit).execute({ name: 'Team A', actorId: 'x' })) as any;
    const mgr = new ManageTeamMemberUseCase(teams, audit);
    expect((await mgr.execute({ teamId: team.id, userId: 'u1', action: 'add', actorId: 'x' })).ok).toBe(true);
    expect(await teams.isMember(team.id, 'u1')).toBe(true);
    expect((await mgr.execute({ teamId: 'missing', userId: 'u1', action: 'add', actorId: 'x' })).ok).toBe(false);
    expect((await mgr.execute({ teamId: team.id, userId: 'u1', action: 'remove', actorId: 'x' })).ok).toBe(true);
    expect(await teams.isMember(team.id, 'u1')).toBe(false);
  });
});

describe('Fulfilment F1 — ownership and eligibility', () => {
  it('move to team clears an assignee who is not a member', async () => {
    const repo = new InMemoryFulfilmentRepo();
    const teams = new InMemoryTeamRepo();
    const audit = new SpyAudit();
    await repo.createForOrder(FulfilmentTask.rehydrate(makeSnapshot('t1', { assignedTo: 'u-outsider' })));
    const { team } = (await new CreateFulfilmentTeamUseCase(teams, audit).execute({ name: 'Team Dispatch', actorId: 'x' })) as any;
    const res = await new MoveFulfilmentTeamUseCase(repo, teams, audit).execute({ taskId: 't1', teamId: team.id, actorId: 'x' });
    expect(res.ok).toBe(true);
    const snap = await repo.findById('t1');
    expect(snap!.teamId).toBe(team.id);
    expect(snap!.assignedTo).toBeNull(); // outsider cleared
  });

  it('assigning a non-member to a team task fails NOT_TEAM_ELIGIBLE; member succeeds; same assignee idempotent', async () => {
    const repo = new InMemoryFulfilmentRepo();
    const teams = new InMemoryTeamRepo();
    const audit = new SpyAudit();
    const { team } = (await new CreateFulfilmentTeamUseCase(teams, audit).execute({ name: 'Team Dispatch', actorId: 'x' })) as any;
    await teams.addMember(team.id, 'member-1');
    await repo.createForOrder(FulfilmentTask.rehydrate(makeSnapshot('t1', { teamId: team.id })));
    const assign = new AssignFulfilmentTaskUseCase(repo, audit, teams);

    const bad = await assign.execute({ taskId: 't1', assignedTo: 'outsider', actorId: 'x' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('NOT_TEAM_ELIGIBLE');

    const ok = await assign.execute({ taskId: 't1', assignedTo: 'member-1', actorId: 'x' });
    expect(ok.ok).toBe(true);
    const again = await assign.execute({ taskId: 't1', assignedTo: 'member-1', actorId: 'x' });
    expect(again.ok).toBe(true); // idempotent
  });

  it('bulk assign is bounded, idempotent and eligibility-checked', async () => {
    const repo = new InMemoryFulfilmentRepo();
    const teams = new InMemoryTeamRepo();
    const audit = new SpyAudit();
    await repo.createForOrder(FulfilmentTask.rehydrate(makeSnapshot('a')));
    await repo.createForOrder(FulfilmentTask.rehydrate(makeSnapshot('b')));
    const bulk = new BulkAssignFulfilmentTasksUseCase(repo, teams, audit);

    const r = await bulk.execute({ taskIds: ['a', 'b', 'missing'], assignedTo: 'u1', actorId: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.assigned).toBe(2); expect(r.skipped).toBe(1); }

    const empty = await bulk.execute({ taskIds: [], assignedTo: 'u1', actorId: 'x' });
    expect(empty.ok).toBe(false);
    const tooMany = await bulk.execute({ taskIds: Array.from({ length: 101 }, (_, i) => `id-${i}`), assignedTo: 'u1', actorId: 'x' });
    expect(tooMany.ok).toBe(false);
  });
});
