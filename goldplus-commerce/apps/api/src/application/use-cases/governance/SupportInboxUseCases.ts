import { ISupportRepository } from '../../ports/ISupportRepository';
import {
  SupportTicket,
  TicketStatus,
  canTransitionTicket,
  ticketSlaState,
  TicketSlaState,
} from '../../../domain/support/SupportTicket';

export interface InboxTicket {
  ticket: SupportTicket;
  sla: TicketSlaState;
}

/** Slice 11: SLA-annotated inbox — overdue first, then priority recency. */
export class GetSupportInboxUseCase {
  constructor(private readonly repo: ISupportRepository) {}

  async execute(): Promise<InboxTicket[]> {
    const now = new Date();
    const tickets = await this.repo.findAll();
    return tickets
      .map((ticket) => ({ ticket, sla: ticketSlaState(ticket.priority, ticket.status, ticket.createdAt, now) }))
      .sort((a, b) => {
        if (a.sla.overdue !== b.sla.overdue) return a.sla.overdue ? -1 : 1;
        return b.ticket.createdAt.getTime() - a.ticket.createdAt.getTime();
      });
  }
}

export type UpdateTicketResult =
  | { ok: true; ticket: SupportTicket }
  | { ok: false; code: string; message: string };

export class UpdateSupportTicketUseCase {
  constructor(private readonly repo: ISupportRepository) {}

  async execute(input: { ticketId: string; status?: string; assignedTo?: string | null }): Promise<UpdateTicketResult> {
    const current = await this.repo.findById(input.ticketId);
    if (!current) return { ok: false, code: 'NOT_FOUND', message: 'Ticket not found.' };

    const patch: { status?: TicketStatus; assignedTo?: string | null } = {};
    if (input.status !== undefined) {
      const next = input.status as TicketStatus;
      if (!['open', 'in-progress', 'resolved', 'closed'].includes(next)) {
        return { ok: false, code: 'INVALID_STATUS', message: 'Unknown ticket status.' };
      }
      if (!canTransitionTicket(current.status, next)) {
        return { ok: false, code: 'ILLEGAL_TRANSITION', message: `Cannot move a ${current.status} ticket to ${next}.` };
      }
      patch.status = next;
    }
    if (input.assignedTo !== undefined) {
      const trimmed = input.assignedTo === null ? null : String(input.assignedTo).trim().slice(0, 120) || null;
      patch.assignedTo = trimmed;
    }
    if (patch.status === undefined && patch.assignedTo === undefined) {
      return { ok: false, code: 'EMPTY_PATCH', message: 'Nothing to update.' };
    }
    const updated = await this.repo.update(input.ticketId, patch);
    if (!updated) return { ok: false, code: 'NOT_FOUND', message: 'Ticket not found.' };
    return { ok: true, ticket: updated };
  }
}
