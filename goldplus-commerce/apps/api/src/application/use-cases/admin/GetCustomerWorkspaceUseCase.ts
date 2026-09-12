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
  /** The support inbox reader; tickets carry the email given at submission. */
  support: { execute(): Promise<Array<{ ticket: { id: string; email?: string | null; subject?: string | null; status: string; priority: string; createdAt: Date; assignedTo?: string | null }; sla?: unknown }>> };
}

export interface CustomerWorkspace {
  user: { id: string; email: string; phone: string | null; isActive: boolean; createdAt: string; phoneVerified: boolean };
  orders: OrderSummaryDto[];
  loyalty: null | (LoyaltyBalance & { accountId: string; entries: Array<{ id: string; type: string; points: number; reason: string; orderId: string | null; createdAt: string; expiresAt: string | null }> });
  support: Array<{ id: string; subject: string | null; status: string; priority: string; assignedTo: string | null; createdAt: string; overdue: boolean }>;
}

export class GetCustomerWorkspaceUseCase {
  constructor(private readonly deps: CustomerWorkspaceDeps) {}

  async execute(userId: string, now: Date = new Date()): Promise<CustomerWorkspace | null> {
    const user = await this.deps.users.findById(userId);
    if (!user) return null;
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
    const email = user.email.trim().toLowerCase();
    const inbox = await this.deps.support.execute();
    const support = inbox
      .filter(({ ticket }) => (ticket.email ?? '').trim().toLowerCase() === email)
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
    };
  }
}
