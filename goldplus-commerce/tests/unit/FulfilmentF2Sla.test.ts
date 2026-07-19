import { describe, it, expect } from 'vitest';
import {
  deriveSlaStage,
  buildSlaIdempotencyKey,
  FulfilmentTask,
  FulfilmentTaskSnapshot,
  FULFILMENT_SLA_GRACE_MS,
} from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository, FulfilmentQueueQuery, FulfilmentQueuePage } from '../../apps/api/src/application/ports/IFulfilmentRepository';
import { IFulfilmentSlaEventRepository, FulfilmentSlaEventInput } from '../../apps/api/src/application/ports/IFulfilmentSlaEventRepository';
import { IFulfilmentTeamRepository, FulfilmentTeam, FulfilmentTeamMember } from '../../apps/api/src/application/ports/IFulfilmentTeamRepository';
import { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';
import { EvaluateFulfilmentSlaBatchUseCase } from '../../apps/api/src/application/use-cases/fulfilment/EvaluateFulfilmentSlaBatchUseCase';

// ---------- domain ----------

describe('F2 — deterministic SLA stage', () => {
  const created = new Date('2026-07-19T00:00:00.000Z');
  const due = new Date('2026-07-19T24:00:00.000Z'); // +24h
  const at = (h: number) => new Date(created.getTime() + h * 3600_000);

  it('ON_TRACK below 75% elapsed', () => {
    expect(deriveSlaStage({ now: at(17), createdAt: created, slaDueAt: due, terminal: false })).toBe('ON_TRACK');
  });
  it('DUE_SOON at/after 75% and before due', () => {
    expect(deriveSlaStage({ now: at(18), createdAt: created, slaDueAt: due, terminal: false })).toBe('DUE_SOON');
    expect(deriveSlaStage({ now: at(23.9), createdAt: created, slaDueAt: due, terminal: false })).toBe('DUE_SOON');
  });
  it('OVERDUE past due within grace', () => {
    expect(deriveSlaStage({ now: at(24.5), createdAt: created, slaDueAt: due, terminal: false })).toBe('OVERDUE');
  });
  it('ESCALATED past due + grace', () => {
    const now = new Date(due.getTime() + FULFILMENT_SLA_GRACE_MS + 1000);
    expect(deriveSlaStage({ now, createdAt: created, slaDueAt: due, terminal: false })).toBe('ESCALATED');
  });
  it('RESOLVED when terminal regardless of clock', () => {
    expect(deriveSlaStage({ now: at(100), createdAt: created, slaDueAt: due, terminal: true })).toBe('RESOLVED');
  });
  it('idempotency key embeds task, stage and policy version', () => {
    expect(buildSlaIdempotencyKey('t1', 'OVERDUE', 3)).toBe('fulfilment:t1:sla:OVERDUE:3');
  });
  it('re-prioritising bumps the policy version', () => {
    const task = FulfilmentTask.openForOrder({
      id: 't', orderId: 'o', orderNumber: 'GP', paymentStatus: 'paid', customerName: 'A', deliveryArea: 'X',
      deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0, items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1, lineTotalUgx: 1 }],
    });
    expect(task.slaPolicyVersion).toBe(1);
    task.setPriority('urgent');
    expect(task.slaPolicyVersion).toBe(2);
  });
});

// ---------- fakes ----------

class SpyAudit implements IAuditRepository {
  saved: any[] = [];
  async save(l: any) { this.saved.push(l); }
  async findAll() { return this.saved; }
  async findByEntity() { return []; }
}
class InMemorySlaEvents implements IFulfilmentSlaEventRepository {
  keys = new Set<string>();
  rows: FulfilmentSlaEventInput[] = [];
  async insertIfNew(input: FulfilmentSlaEventInput) {
    if (this.keys.has(input.idempotencyKey)) return { created: false };
    this.keys.add(input.idempotencyKey); this.rows.push(input); return { created: true };
  }
  async countByStage() {
    const out: Record<string, number> = {};
    for (const r of this.rows) out[r.stage] = (out[r.stage] ?? 0) + 1;
    return out;
  }
  async latestForTask() { return null; }
}
class InMemoryTeams implements IFulfilmentTeamRepository {
  leads = new Map<string, string[]>();
  async createTeam() { return { ok: false as const, code: 'DUPLICATE' as const }; }
  async listTeams(): Promise<FulfilmentTeam[]> { return []; }
  async findById() { return null; }
  async addMember() { return { added: true }; }
  async removeMember() { return { removed: true }; }
  async listMembers(): Promise<FulfilmentTeamMember[]> { return []; }
  async isMember() { return true; }
  async listLeads(teamId: string) { return this.leads.get(teamId) ?? []; }
  async setLead() { return { updated: true }; }
}
function makeSnap(id: string, over: Partial<FulfilmentTaskSnapshot>): FulfilmentTaskSnapshot {
  const t = FulfilmentTask.openForOrder({
    id, orderId: `o-${id}`, orderNumber: `GP-${id}`, paymentStatus: 'paid', customerName: 'A', deliveryArea: 'X',
    deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0, items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1, lineTotalUgx: 1 }],
  });
  return { ...t.toSnapshot(), ...over };
}
class InMemoryFulfilment implements IFulfilmentRepository {
  active: FulfilmentTaskSnapshot[] = [];
  async createForOrder(t: FulfilmentTask) { return { created: true, task: t.toSnapshot() }; }
  async findByOrderId() { return null; }
  async findById() { return null; }
  async update() {}
  async listQueue(): Promise<FulfilmentQueuePage> { return { tasks: [], total: 0 }; }
  async countNew() { return 0; }
  async countOverdue() { return 0; }
  async findActiveForSla() { return this.active; }
}

describe('F2 — idempotent SLA evaluator', () => {
  const created = new Date('2026-07-19T00:00:00.000Z');
  const dueSoon = new Date('2026-07-19T24:00:00.000Z');
  const now = new Date('2026-07-19T18:30:00.000Z'); // 77% elapsed → DUE_SOON

  it('records one event per task/stage/version; repeated ticks do not duplicate', async () => {
    const tasks = new InMemoryFulfilment();
    tasks.active = [makeSnap('t1', { createdAt: created, slaDueAt: dueSoon })];
    const events = new InMemorySlaEvents();
    const uc = new EvaluateFulfilmentSlaBatchUseCase(tasks, events, new InMemoryTeams(), new SpyAudit());
    const r1 = await uc.execute({ now });
    const r2 = await uc.execute({ now });
    expect(r1.transitions).toBe(1);
    expect(r2.transitions).toBe(0); // idempotent
    expect(events.rows.length).toBe(1);
    expect(events.rows[0].stage).toBe('DUE_SOON');
  });

  it('a new policy version creates a fresh event for the same stage', async () => {
    const tasks = new InMemoryFulfilment();
    tasks.active = [makeSnap('t1', { createdAt: created, slaDueAt: dueSoon, slaPolicyVersion: 1 })];
    const events = new InMemorySlaEvents();
    const uc = new EvaluateFulfilmentSlaBatchUseCase(tasks, events, new InMemoryTeams(), new SpyAudit());
    await uc.execute({ now });
    tasks.active = [makeSnap('t1', { createdAt: created, slaDueAt: dueSoon, slaPolicyVersion: 2 })];
    const r = await uc.execute({ now });
    expect(r.transitions).toBe(1);
    expect(events.rows.length).toBe(2);
  });

  it('escalation without a team lead records MISSING_TEAM_LEAD and does not fail', async () => {
    const escalatedNow = new Date(dueSoon.getTime() + FULFILMENT_SLA_GRACE_MS + 1000);
    const tasks = new InMemoryFulfilment();
    tasks.active = [makeSnap('t1', { createdAt: created, slaDueAt: dueSoon, teamId: 'team-x' })];
    const events = new InMemorySlaEvents();
    const r = await new EvaluateFulfilmentSlaBatchUseCase(tasks, events, new InMemoryTeams(), new SpyAudit()).execute({ now: escalatedNow });
    expect(r.escalated).toBe(1);
    expect(r.missingTeamLead).toBe(1);
    expect(events.rows[0].detail).toMatch(/MISSING_TEAM_LEAD/);
  });

  it('escalation with configured leads records the lead count', async () => {
    const escalatedNow = new Date(dueSoon.getTime() + FULFILMENT_SLA_GRACE_MS + 1000);
    const tasks = new InMemoryFulfilment();
    tasks.active = [makeSnap('t1', { createdAt: created, slaDueAt: dueSoon, teamId: 'team-x' })];
    const teams = new InMemoryTeams();
    teams.leads.set('team-x', ['lead-1', 'lead-2']);
    const events = new InMemorySlaEvents();
    const r = await new EvaluateFulfilmentSlaBatchUseCase(tasks, events, teams, new SpyAudit()).execute({ now: escalatedNow });
    expect(r.missingTeamLead).toBe(0);
    expect(events.rows[0].detail).toMatch(/2 team lead/);
  });

  it('ON_TRACK tasks record no event', async () => {
    const tasks = new InMemoryFulfilment();
    tasks.active = [makeSnap('t1', { createdAt: created, slaDueAt: dueSoon })];
    const events = new InMemorySlaEvents();
    const r = await new EvaluateFulfilmentSlaBatchUseCase(tasks, events, new InMemoryTeams(), new SpyAudit()).execute({ now: new Date(created.getTime() + 3600_000) });
    expect(r.transitions).toBe(0);
    expect(events.rows.length).toBe(0);
  });
});
