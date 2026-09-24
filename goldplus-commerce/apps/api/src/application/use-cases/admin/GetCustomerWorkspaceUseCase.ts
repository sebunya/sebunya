import type { OrderSummaryDto } from '@goldplus/shared';
import { computeBalance, type LoyaltyLedgerEntry, type LoyaltyBalance } from '../../../domain/loyalty/LoyaltyLedger';

/**
 * One customer, one screen (admin maturity pass, 2026-09-12, §10/§18).
 * Aggregates what already exists — the account, its orders, its loyalty
 * ledger and its support tickets — through the existing readers, so a
 * customer-service agent can answer "what has happened with this customer"
 * without opening five modules. Summaries + links, never a second copy of
 * any module. No password hash, no tokens: only the fields listed here.
 */
export interface CustomerWorkspaceDeps {
  users: { findById(id: string): Promise<{ id: string; email: string; phone: string | null; isActive: boolean; createdAt: Date; phoneVerifiedAt?: Date | null } | null> };
  orders: { listForUser(userId: string): Promise<OrderSummaryDto[]> };
  loyalty: {
    findAccountByUserId(userId: string): Promise<{ id: string } | null>;
    listEntries(accountId: string): Promise<LoyaltyLedgerEntry[]>;
  };
  /**
   * Whether this account holds ANY staff permission. The workspace is for
   * customers: a staff id used to return a colleague's email and phone to
   * anyone with orders.read.
   */
  staff: { isStaff(userId: string): Promise<boolean> };
  /**
   * One customer's support tickets, queried for THIS customer only (signed-in
   * id, or the email given at submission, which public tickets keep in
   * metadata.email). It used to read the whole inbox and filter in memory on a
   * `ticket.email` field that tickets do not have, so emailed tickets never
   * showed.
   */
  support: { forCustomer(query: { customerId: string; email: string | null }, now: Date): Promise<Array<{ ticket: { id: string; subject?: string | null; status: string; priority: string; createdAt: Date; assignedTo?: string | null }; sla?: unknown }>> };
}

export interface CustomerWorkspace {
  user: { id: string; email: string; phone: string | null; isActive: boolean; createdAt: string; phoneVerified: boolean };
  orders: OrderSummaryDto[];
  loyalty: null | (LoyaltyBalance & { accountId: string; entries: Array<{ id: string; type: string; points: number; reason: string; orderId: string | null; createdAt: string; expiresAt: string | null }> });
  support: Array<{ id: string; subject: string | null; status: string; priority: string; assignedTo: string | null; createdAt: string; overdue: boolean }>;
  /** False when the caller may not read support tickets: an empty list then means "not shown", not "none". */
  supportIncluded: boolean;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GetCustomerWorkspaceUseCase {
  constructor(private readonly deps: CustomerWorkspaceDeps) {}

  /**
   * `includeSupport` is the caller's right to read support tickets
   * (reports.read, the same gate as /admin/support). orders.read alone used to
   * bring ticket subjects and assignees along with it; without the right the
   * support list is empty and the inbox is never read.
   */
  async execute(userId: string, now: Date = new Date(), options: { includeSupport?: boolean } = {}): Promise<CustomerWorkspace | null> {
    // Not an id at all is "not found", not a database error (it was a 500).
    if (!UUID_SHAPE.test(userId)) return null;
    const user = await this.deps.users.findById(userId);
    if (!user) return null;
    if (await this.deps.staff.isStaff(user.id)) return null;
    const [orders, account] = await Promise.all([this.deps.orders.listForUser(user.id), this.deps.loyalty.findAccountByUserId(user.id)]);
    let loyalty: CustomerWorkspace['loyalty'] = null;
    if (account) {
      const entries = await this.deps.loyalty.listEntries(account.id);
      const balance = computeBalance(entries, now);
      loyalty = {
        ...balance,
        accountId: account.id,
        entries: [...entries]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 20)
          .map((e) => ({ id: e.id, type: e.type, points: e.points, reason: e.reason, orderId: e.orderId, createdAt: e.createdAt.toISOString(), expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null })),
      };
    }
    const email = user.email.trim().toLowerCase() || null;
    // A ticket filed while signed in carries the customer's id even when it
    // was sent with another email (or a phone number) — the query matches either.
    const tickets = options.includeSupport ? await this.deps.support.forCustomer({ customerId: user.id, email }, now) : [];
    const support = tickets
      .map(({ ticket, sla }) => ({
        id: ticket.id, subject: ticket.subject ?? null, status: ticket.status, priority: ticket.priority,
        assignedTo: ticket.assignedTo ?? null, createdAt: ticket.createdAt.toISOString(),
        overdue: Boolean((sla as { overdue?: boolean } | undefined)?.overdue),
      }));
    return {
      user: { id: user.id, email: user.email, phone: user.phone, isActive: user.isActive, createdAt: user.createdAt.toISOString(), phoneVerified: Boolean(user.phoneVerifiedAt) },
      orders: [...orders].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      loyalty,
      support,
      supportIncluded: Boolean(options.includeSupport),
    };
  }
}
