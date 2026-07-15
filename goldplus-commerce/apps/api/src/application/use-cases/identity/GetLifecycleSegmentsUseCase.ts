import { ILifecycleReadRepository } from '../../ports/ILifecycleReadRepository';
import {
  lifecycleStage,
  nextBestAction,
  LifecycleStage,
  NextBestAction,
} from '../../../domain/identity/CustomerLifecycle';

export interface LifecycleCustomerRow {
  userId: string;
  ordersCount: number;
  lastOrderAt: Date | null;
  stage: LifecycleStage;
  stageExplanation: string;
  nba: NextBestAction;
}

export interface LifecycleSegmentsReport {
  generatedAt: Date;
  totals: Record<LifecycleStage, number>;
  suppressedCount: number;
  customers: LifecycleCustomerRow[];
}

/**
 * Slice 9: deterministic, consent-bound lifecycle segments over existing
 * order/consent data. Read-only; contains no names, contacts, or scores.
 */
export class GetLifecycleSegmentsUseCase {
  constructor(private readonly reads: ILifecycleReadRepository) {}

  async execute(): Promise<LifecycleSegmentsReport> {
    const now = new Date();
    const stats = await this.reads.listCustomerOrderStats();
    const consent = await this.reads.getPersonalisationConsent(stats.map((s) => s.userId));

    const totals: Record<LifecycleStage, number> = { prospect: 0, new: 0, active: 0, at_risk: 0, dormant: 0 };
    let suppressedCount = 0;
    const customers = stats.map((s) => {
      const staged = lifecycleStage(
        { ordersCount: s.ordersCount, firstOrderAt: s.firstOrderAt, lastOrderAt: s.lastOrderAt },
        now
      );
      const nba = nextBestAction(staged.stage, consent.get(s.userId) ?? 'unknown');
      totals[staged.stage] += 1;
      if (nba.suppressed) suppressedCount += 1;
      return {
        userId: s.userId,
        ordersCount: s.ordersCount,
        lastOrderAt: s.lastOrderAt,
        stage: staged.stage,
        stageExplanation: staged.explanation,
        nba,
      };
    });

    return { generatedAt: now, totals, suppressedCount, customers };
  }
}
