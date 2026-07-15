import { db } from '../client';
import { supportIssues } from '../schema/governance';
import { eq } from 'drizzle-orm';
import { SupportTicket } from '../../../domain/support/SupportTicket';

export class DrizzleSupportRepository {
  async save(ticket: SupportTicket): Promise<void> {
    await db.insert(supportIssues).values({
      id: ticket.id,
      customerId: ticket.customerId,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      type: ticket.type,
      metadata: ticket.metadata,
      createdAt: ticket.createdAt,
    }).onConflictDoUpdate({
      target: supportIssues.id,
      set: {
        status: ticket.status,
        priority: ticket.priority,
        metadata: ticket.metadata,
      }
    });
  }

  async findById(id: string): Promise<SupportTicket | null> {
    const result = await db.query.supportIssues.findFirst({
      where: eq(supportIssues.id, id),
    });

    if (!result) return null;

    return new SupportTicket(
      result.id,
      result.customerId,
      result.subject,
      result.description,
      result.status as any,
      result.priority as any,
      result.type as any,
      result.createdAt,
      result.metadata as Record<string, any>,
      result.assignedTo ?? null,
      result.updatedAt ?? null
    );
  }

  async update(id: string, patch: { status?: SupportTicket['status']; assignedTo?: string | null }): Promise<SupportTicket | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.assignedTo !== undefined) set.assignedTo = patch.assignedTo;
    const [row] = await db.update(supportIssues).set(set).where(eq(supportIssues.id, id)).returning();
    if (!row) return null;
    return this.findById(row.id);
  }

  async findAll(): Promise<SupportTicket[]> {
    const results = await db.query.supportIssues.findMany();
    return results.map(r => new SupportTicket(
      r.id,
      r.customerId,
      r.subject,
      r.description,
      r.status as any,
      r.priority as any,
      r.type as any,
      r.createdAt,
      r.metadata as Record<string, any>,
      r.assignedTo ?? null,
      r.updatedAt ?? null
    ));
  }
}
