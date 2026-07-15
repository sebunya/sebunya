export type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Legal status transitions (Slice 11). Reopening a resolved/closed ticket is allowed. */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in-progress', 'resolved', 'closed'],
  'in-progress': ['open', 'resolved', 'closed'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return from === to ? false : TRANSITIONS[from]?.includes(to) ?? false;
}

/** First-response SLA targets in hours, by priority. Deterministic, not invented per ticket. */
export const SLA_HOURS: Record<TicketPriority, number> = { urgent: 4, high: 24, medium: 72, low: 168 };

export interface TicketSlaState {
  dueAt: Date;
  overdue: boolean;
  hoursRemaining: number;
}

/** SLA applies while a ticket is still open/in-progress; resolved/closed tickets are never overdue. */
export function ticketSlaState(priority: TicketPriority, status: TicketStatus, createdAt: Date, now: Date): TicketSlaState {
  const dueAt = new Date(createdAt.getTime() + SLA_HOURS[priority] * 60 * 60 * 1000);
  const active = status === 'open' || status === 'in-progress';
  const msRemaining = dueAt.getTime() - now.getTime();
  return {
    dueAt,
    overdue: active && msRemaining < 0,
    hoursRemaining: Math.floor(msRemaining / (60 * 60 * 1000)),
  };
}

export class SupportTicket {
  constructor(
    public readonly id: string,
    public readonly customerId: string | null,
    public readonly subject: string,
    public readonly description: string,
    public readonly status: TicketStatus,
    public readonly priority: TicketPriority,
    public readonly type: 'issue' | 'fake_report' | 'inquiry',
    public readonly createdAt: Date,
    public readonly metadata: Record<string, any> = {},
    public readonly assignedTo: string | null = null,
    public readonly updatedAt: Date | null = null
  ) {}

  public static create(
    id: string,
    customerId: string | null,
    subject: string,
    description: string,
    type: 'issue' | 'fake_report' | 'inquiry'
  ): SupportTicket {
    const priority = type === 'fake_report' ? 'high' : 'medium';
    return new SupportTicket(
      id,
      customerId,
      subject,
      description,
      'open',
      priority,
      type,
      new Date()
    );
  }

  public static open(
    id: string,
    customerId: string | null,
    subject: string,
    description: string,
    type: 'issue' | 'fake_report' | 'inquiry',
    priority: TicketPriority,
    metadata: Record<string, any> = {}
  ): SupportTicket {
    return new SupportTicket(
      id,
      customerId,
      subject,
      description,
      'open',
      priority,
      type,
      new Date(),
      metadata
    );
  }
}
