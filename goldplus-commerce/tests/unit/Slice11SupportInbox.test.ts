import { describe, it, expect } from 'vitest';
import {
  SupportTicket,
  canTransitionTicket,
  ticketSlaState,
  SLA_HOURS,
} from '../../apps/api/src/domain/support/SupportTicket';
import {
  GetSupportInboxUseCase,
  UpdateSupportTicketUseCase,
} from '../../apps/api/src/application/use-cases/governance/SupportInboxUseCases';
import { ISupportRepository } from '../../apps/api/src/application/ports/ISupportRepository';

const now = new Date('2026-07-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

const ticket = (over: Partial<SupportTicket> = {}): SupportTicket =>
  new SupportTicket(
    over.id ?? 't1',
    null,
    over.subject ?? 'Broken charger',
    'desc',
    over.status ?? 'open',
    over.priority ?? 'medium',
    'issue',
    over.createdAt ?? now,
    {},
    over.assignedTo ?? null,
    null
  );

function fakeRepo(rows: SupportTicket[]): ISupportRepository & { rows: SupportTicket[] } {
  let store = [...rows];
  return {
    get rows() { return store; },
    async save(t) { store.push(t); },
    async findAll() { return store; },
    async findById(id) { return store.find((t) => t.id === id) ?? null; },
    async update(id, patch) {
      const cur = store.find((t) => t.id === id);
      if (!cur) return null;
      const next = new SupportTicket(
        cur.id, cur.customerId, cur.subject, cur.description,
        patch.status ?? cur.status, cur.priority, cur.type, cur.createdAt, cur.metadata,
        patch.assignedTo !== undefined ? patch.assignedTo : cur.assignedTo, new Date()
      );
      store = store.map((t) => (t.id === id ? next : t));
      return next;
    },
  };
}

describe('Support inbox domain (Slice 11)', () => {
  it('permits only sensible status transitions, including reopen', () => {
    expect(canTransitionTicket('open', 'in-progress')).toBe(true);
    expect(canTransitionTicket('in-progress', 'resolved')).toBe(true);
    expect(canTransitionTicket('resolved', 'open')).toBe(true);
    expect(canTransitionTicket('closed', 'open')).toBe(true);
    expect(canTransitionTicket('closed', 'resolved')).toBe(false);
    expect(canTransitionTicket('open', 'open')).toBe(false);
  });

  it('computes deterministic SLA state per priority and never marks closed tickets overdue', () => {
    expect(SLA_HOURS.urgent).toBe(4);
    const overdue = ticketSlaState('urgent', 'open', hoursAgo(5), now);
    expect(overdue.overdue).toBe(true);
    const fresh = ticketSlaState('medium', 'open', hoursAgo(1), now);
    expect(fresh.overdue).toBe(false);
    expect(fresh.hoursRemaining).toBe(71);
    const closed = ticketSlaState('urgent', 'closed', hoursAgo(100), now);
    expect(closed.overdue).toBe(false);
  });
});

describe('Support inbox use cases (Slice 11)', () => {
  it('sorts overdue tickets first', async () => {
    const repo = fakeRepo([
      ticket({ id: 'fresh', priority: 'low', createdAt: hoursAgo(1) }),
      ticket({ id: 'late', priority: 'urgent', createdAt: hoursAgo(10) }),
    ]);
    const inbox = await new GetSupportInboxUseCase(repo).execute(now);
    expect(inbox[0].ticket.id).toBe('late');
    expect(inbox[0].sla.overdue).toBe(true);
  });

  it('rejects illegal transitions and unknown statuses', async () => {
    const repo = fakeRepo([ticket({ id: 't1', status: 'closed' })]);
    const uc = new UpdateSupportTicketUseCase(repo);
    expect((await uc.execute({ ticketId: 't1', status: 'resolved' })).ok).toBe(false);
    expect((await uc.execute({ ticketId: 't1', status: 'archived' })).ok).toBe(false);
    expect((await uc.execute({ ticketId: 'missing', status: 'open' })).ok).toBe(false);
    expect((await uc.execute({ ticketId: 't1' })).ok).toBe(false); // empty patch
  });

  it('applies legal transitions and assignment', async () => {
    const repo = fakeRepo([ticket({ id: 't1', status: 'open' })]);
    const uc = new UpdateSupportTicketUseCase(repo);
    const result = await uc.execute({ ticketId: 't1', status: 'in-progress', assignedTo: '  Grace  ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ticket.status).toBe('in-progress');
      expect(result.ticket.assignedTo).toBe('Grace');
    }
    const unassign = await uc.execute({ ticketId: 't1', assignedTo: null });
    expect(unassign.ok && unassign.ok === true && (unassign as any).ticket.assignedTo).toBeNull();
  });
});
