import { FulfilmentTaskSnapshot, deriveSlaStage, FulfilmentSlaStage } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IFulfilmentSlaEventRepository } from '../../ports/IFulfilmentSlaEventRepository';

export interface FulfilmentSlaSummary {
  onTrack: number;
  dueSoon: number;
  overdue: number;
  escalated: number;
  resolvedToday: number;
  missingTeamLead: number;
  policyVersionSpread: Record<string, number>;
}

/** Admin badge + single-task lookups + live SLA summary for the fulfilment surface. */
export class GetFulfilmentOverviewUseCase {
  constructor(
    private readonly repo: IFulfilmentRepository,
    private readonly slaEvents?: IFulfilmentSlaEventRepository
  ) {}

  /**
   * Admin badges: unacknowledged NEW tasks ("New Orders") and active tasks past
   * their SLA deadline ("Overdue").
   */
  async badge(now: Date = new Date()): Promise<{ newOrders: number; overdue: number; unworkable: number }> {
    const [newOrders, overdue, orphans] = await Promise.all([
      this.repo.countNew(),
      this.repo.countOverdue(now),
      this.repo.findOrdersWithoutActiveTask(200),
    ]);
    // Orders nobody can pick: live, but with a terminal task or none at all.
    // They are absent from the queue and still open to the customer, so without
    // this they are simply never seen again.
    return { newOrders, overdue, unworkable: orphans.length };
  }

  /** The orders behind that count, so the operator can act on them by name. */
  async unworkableOrders(limit = 50) {
    return this.repo.findOrdersWithoutActiveTask(limit);
  }

  /** Live SLA stage counts derived from active tasks, plus persisted escalation totals. */
  async slaSummary(now: Date = new Date()): Promise<FulfilmentSlaSummary> {
    const active = await this.repo.findActiveForSla(1000);
    const counts: Record<FulfilmentSlaStage, number> = { ON_TRACK: 0, DUE_SOON: 0, OVERDUE: 0, ESCALATED: 0, RESOLVED: 0 };
    const policyVersionSpread: Record<string, number> = {};
    for (const t of active) {
      const stage = deriveSlaStage({ now, createdAt: t.createdAt, slaDueAt: t.slaDueAt, terminal: false });
      counts[stage]++;
      const v = String(t.slaPolicyVersion);
      policyVersionSpread[v] = (policyVersionSpread[v] ?? 0) + 1;
    }
    // Persisted escalation totals reflect recorded transitions (idempotent events).
    const byEvent = this.slaEvents ? await this.slaEvents.countByStage() : {};
    return {
      onTrack: counts.ON_TRACK,
      dueSoon: counts.DUE_SOON,
      overdue: counts.OVERDUE,
      escalated: byEvent['ESCALATED'] ?? counts.ESCALATED,
      resolvedToday: 0, // resolved = terminal; surfaced via reporting (F5)
      missingTeamLead: 0,
      policyVersionSpread,
    };
  }

  async byId(id: string): Promise<FulfilmentTaskSnapshot | null> {
    if (!id) return null;
    return this.repo.findById(id);
  }

  async byOrderId(orderId: string): Promise<FulfilmentTaskSnapshot | null> {
    if (!orderId) return null;
    return this.repo.findByOrderId(orderId);
  }
}
