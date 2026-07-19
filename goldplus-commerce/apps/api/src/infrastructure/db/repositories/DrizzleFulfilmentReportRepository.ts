import { db } from '../client';
import { fulfilmentTasks, fulfilmentDispatches, fulfilmentDeliveries, fulfilmentLines, packingSessions } from '../schema/fulfilment';
import { and, eq, isNull, sql, gt, notInArray } from 'drizzle-orm';
import { deriveSlaStage } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentReportRepository, FulfilmentReport } from '../../../application/ports/IFulfilmentReportRepository';

const TERMINAL = ['DELIVERED', 'CANCELLED'];

export class DrizzleFulfilmentReportRepository implements IFulfilmentReportRepository {
  async buildReport(now: Date): Promise<FulfilmentReport> {
    // Queue by status.
    const statusRows = await db
      .select({ status: fulfilmentTasks.status, n: sql<number>`count(*)::int` })
      .from(fulfilmentTasks)
      .groupBy(fulfilmentTasks.status);
    const byStatus: Record<string, number> = {};
    let total = 0;
    let active = 0;
    for (const r of statusRows) {
      byStatus[r.status] = r.n;
      total += r.n;
      if (!TERMINAL.includes(r.status)) active += r.n;
    }

    const [unassignedRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(fulfilmentTasks)
      .where(and(isNull(fulfilmentTasks.assignedTo), notInArray(fulfilmentTasks.status, TERMINAL)));
    const unassigned = unassignedRow?.n ?? 0;

    // SLA stage counts over active tasks (same derivation as the live summary).
    const activeTasks = await db
      .select({ createdAt: fulfilmentTasks.createdAt, slaDueAt: fulfilmentTasks.slaDueAt })
      .from(fulfilmentTasks)
      .where(notInArray(fulfilmentTasks.status, TERMINAL));
    const sla = { onTrack: 0, dueSoon: 0, overdue: 0, escalated: 0 };
    for (const t of activeTasks) {
      const stage = deriveSlaStage({ now, createdAt: t.createdAt, slaDueAt: t.slaDueAt, terminal: false });
      if (stage === 'ON_TRACK') sla.onTrack += 1;
      else if (stage === 'DUE_SOON') sla.dueSoon += 1;
      else if (stage === 'OVERDUE') sla.overdue += 1;
      else if (stage === 'ESCALATED') sla.escalated += 1;
    }

    // Packing: completed packing sessions and tasks carrying a backordered line.
    const [packedRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(packingSessions)
      .where(eq(packingSessions.status, 'COMPLETED'));
    const [backorderRow] = await db
      .select({ n: sql<number>`count(distinct ${fulfilmentLines.fulfilmentTaskId})::int` })
      .from(fulfilmentLines)
      .where(gt(fulfilmentLines.backorderedQuantity, 0));

    // Dispatch.
    const [dispatchRow] = await db.select({ n: sql<number>`count(*)::int` }).from(fulfilmentDispatches);

    // Delivery outcomes.
    const deliveryRows = await db
      .select({ outcome: fulfilmentDeliveries.outcome, n: sql<number>`count(*)::int` })
      .from(fulfilmentDeliveries)
      .groupBy(fulfilmentDeliveries.outcome);
    const delivery = { delivered: 0, failed: 0, rescheduled: 0, returnToOrigin: 0, partiallyDelivered: 0 };
    for (const r of deliveryRows) {
      if (r.outcome === 'DELIVERED') delivery.delivered = r.n;
      else if (r.outcome === 'DELIVERY_FAILED') delivery.failed = r.n;
      else if (r.outcome === 'RESCHEDULED') delivery.rescheduled = r.n;
      else if (r.outcome === 'RETURN_TO_ORIGIN') delivery.returnToOrigin = r.n;
      else if (r.outcome === 'PARTIALLY_DELIVERED') delivery.partiallyDelivered = r.n;
    }

    // Cycle time: created → delivered (hours), over DELIVERED delivery rows.
    const [cycleRow] = await db
      .select({
        cnt: sql<number>`count(*)::int`,
        avgHours: sql<number | null>`avg(extract(epoch from (${fulfilmentDeliveries.deliveredAt} - ${fulfilmentTasks.createdAt})) / 3600.0)`,
      })
      .from(fulfilmentDeliveries)
      .innerJoin(fulfilmentTasks, eq(fulfilmentDeliveries.fulfilmentTaskId, fulfilmentTasks.id))
      .where(and(eq(fulfilmentDeliveries.outcome, 'DELIVERED'), sql`${fulfilmentDeliveries.deliveredAt} is not null`));
    const avgHours = cycleRow?.avgHours != null ? Math.round(Number(cycleRow.avgHours) * 10) / 10 : null;

    // Active work by team and by assignee.
    const teamRows = await db
      .select({ teamId: fulfilmentTasks.teamId, n: sql<number>`count(*)::int` })
      .from(fulfilmentTasks)
      .where(notInArray(fulfilmentTasks.status, TERMINAL))
      .groupBy(fulfilmentTasks.teamId);
    const assigneeRows = await db
      .select({ assignedTo: fulfilmentTasks.assignedTo, n: sql<number>`count(*)::int` })
      .from(fulfilmentTasks)
      .where(notInArray(fulfilmentTasks.status, TERMINAL))
      .groupBy(fulfilmentTasks.assignedTo);

    return {
      generatedAt: now.toISOString(),
      queue: { total, active, unassigned, byStatus },
      sla,
      packing: { packedTasks: packedRow?.n ?? 0, backorderedTasks: backorderRow?.n ?? 0 },
      dispatch: { dispatched: dispatchRow?.n ?? 0 },
      delivery,
      cycleTime: { deliveredCount: cycleRow?.cnt ?? 0, avgHoursCreatedToDelivered: avgHours },
      byTeam: teamRows.map((r) => ({ teamId: r.teamId ?? null, active: r.n })),
      byAssignee: assigneeRows.map((r) => ({ assignedTo: r.assignedTo ?? null, active: r.n })),
    };
  }
}
