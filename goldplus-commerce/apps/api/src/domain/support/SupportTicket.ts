export type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

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
    public readonly metadata: Record<string, any> = {}
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
