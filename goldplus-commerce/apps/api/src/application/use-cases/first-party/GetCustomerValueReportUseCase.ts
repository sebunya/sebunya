import { customerValue, summariseCustomerValue, cohortRetention, CustomerValueRow } from '../../../domain/first-party/CustomerValue';
import type { ICustomerFactsReader, ISegmentRepository } from '../../ports/first-party/FirstPartyPorts';

/**
 * LTV and repeat purchase for the admin report. Honest empty states are part
 * of the contract: `status: 'NO_DATA'` when no customer has an order yet, and
 * every rate over nobody is null. `identityCoverage` says how complete the
 * customer view is (orders linked to a customer / all orders), because an LTV
 * over half the orders is not an LTV.
 */
export class GetCustomerValueReportUseCase {
  constructor(
    private readonly facts: ICustomerFactsReader,
    private readonly segments: ISegmentRepository,
    private readonly coverage: { orderLinkCoverage(): Promise<{ orders: number; linkedOrders: number }> },
  ) {}

  async execute(input: { now?: Date; top?: number; cohortMonths?: number } = {}) {
    const now = input.now ?? new Date();
    const [facts, coverage, lastRunAt] = await Promise.all([
      this.facts.readAll(now),
      this.coverage.orderLinkCoverage(),
      this.segments.lastCompletedRunAt(),
    ]);
    const rows = facts.map(customerValue).filter((r): r is CustomerValueRow => r !== null);
    const summary = summariseCustomerValue(rows);
    const top = [...rows]
      .sort((a, b) => b.lifetimeValueUgx - a.lifetimeValueUgx || b.orderCount - a.orderCount)
      .slice(0, Math.min(Math.max(1, input.top ?? 25), 100))
      .map((r) => ({ ...r, customer: `${r.canonicalCustomerId.slice(0, 8)}…` }));
    const distribution = {
      oneOrder: rows.filter((r) => r.orderCount === 1).length,
      twoOrders: rows.filter((r) => r.orderCount === 2).length,
      threeOrMore: rows.filter((r) => r.orderCount >= 3).length,
    };
    return {
      status: rows.length === 0 ? ('NO_DATA' as const) : ('OK' as const),
      generatedAt: now.toISOString(),
      lastLinkRunAt: lastRunAt ? lastRunAt.toISOString() : null,
      identityCoverage: {
        orders: coverage.orders,
        linkedOrders: coverage.linkedOrders,
        share: coverage.orders ? coverage.linkedOrders / coverage.orders : null,
      },
      summary,
      distribution,
      top,
      cohorts: cohortRetention(facts, now, Math.min(Math.max(1, input.cohortMonths ?? 12), 24)),
    };
  }
}
