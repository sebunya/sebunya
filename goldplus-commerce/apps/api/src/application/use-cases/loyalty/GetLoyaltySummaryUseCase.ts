import { summariseLedger, LoyaltyTier } from '../../../domain/loyalty/Loyalty';
import { ILoyaltyLedgerRepository } from '../../ports/ILoyaltyLedgerRepository';

export interface LoyaltySummary {
  balance: number;
  lifetimeEarned: number;
  tier: LoyaltyTier;
  recent: Array<{
    id: string;
    orderId: string | null;
    points: number;
    reason: string;
    description: string | null;
    createdAt: string;
  }>;
}

const RECENT_LIMIT = 20;

export class GetLoyaltySummaryUseCase {
  constructor(private readonly ledger: ILoyaltyLedgerRepository) {}

  async execute(userId: string): Promise<LoyaltySummary> {
    const entries = await this.ledger.listForUser(userId, 500);
    const summary = summariseLedger(entries);
    return {
      ...summary,
      recent: entries.slice(0, RECENT_LIMIT).map((e) => ({
        id: e.id,
        orderId: e.orderId,
        points: e.points,
        reason: e.reason,
        description: e.description,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}
