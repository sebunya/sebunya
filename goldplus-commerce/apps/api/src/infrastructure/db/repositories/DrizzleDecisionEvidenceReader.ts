import { db } from '../client';
import { orders } from '../schema/commerce';
import { products } from '../schema/products';
import { customerProfiles } from '../schema/customer_dna';
import { nbaDecisions } from '../schema/customer_dna';
import { fulfilmentTasks, fulfilmentLines, fulfilmentDeliveries } from '../schema/fulfilment';
import { searchDemandSignals } from '../schema/search';
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { DecisionSignalType, DecisionPolicy, EvidenceInput } from '../../../domain/decision-intelligence/DecisionIntelligence';
import { IDecisionEvidenceReader } from '../../../application/ports/IDecisionIntelligenceRepository';

const DAY = 86_400_000;
const missing = (sourceType: string): EvidenceInput => ({ dependencyAvailable: false, currentValue: 0, baselineValue: 0, currentSample: 0, baselineSample: 0, freshestAt: null, sourceType, sourceRef: 'n/a', sourceVersion: 0 });
function ver(d: Date | null | undefined): number { return d ? Math.floor(d.getTime() / 1000) : 0; }

/**
 * Phase 1 of the two-phase model: build deterministic evidence snapshots from
 * real persisted data. No policy evaluation and no narrative here — only counts,
 * rates and windows drawn from authoritative tables.
 */
export class DrizzleDecisionEvidenceReader implements IDecisionEvidenceReader {
  async readEvidence(signalType: DecisionSignalType, policy: DecisionPolicy, now: Date): Promise<EvidenceInput> {
    switch (signalType) {
      case 'ORDER_VOLUME_MOVEMENT': return this.orderVolume(policy, now);
      case 'PAYMENT_FAILURE_SPIKE': return this.paymentFailure(policy, now);
      case 'AT_RISK_CUSTOMER_GROWTH': return this.lifecycleCount('AT_RISK', now);
      case 'LAPSED_CUSTOMER_GROWTH': return this.lifecycleCount('LAPSED', now);
      case 'NBA_NO_ACTION_RATE': return this.nbaNoAction(policy, now);
      case 'LOW_STOCK_RISK': return this.lowStock(now);
      case 'BACKORDER_EXPOSURE': return this.backorder(now);
      case 'UNASSIGNED_FULFILMENT_GROWTH': return this.unassigned(now);
      case 'SLA_BREACH_GROWTH': return this.slaBreach(now);
      case 'DELIVERY_FAILURE_SPIKE': return this.deliveryFailure(policy, now);
      case 'ZERO_RESULT_SEARCH_GROWTH': return this.zeroResultSearch(policy, now);
      default: return missing('unknown');
    }
  }

  private async orderVolume(p: DecisionPolicy, now: Date): Promise<EvidenceInput> {
    const curFrom = new Date(now.getTime() - p.currentWindowDays * DAY);
    const baseFrom = new Date(now.getTime() - (p.currentWindowDays + p.baselineWindowDays) * DAY);
    const [cur] = await db.select({ n: sql<number>`count(*)::int`, f: sql<Date | null>`max(${orders.createdAt})` }).from(orders).where(gte(orders.createdAt, curFrom));
    const [base] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(gte(orders.createdAt, baseFrom), lt(orders.createdAt, curFrom)));
    const baselinePerWindow = (base?.n ?? 0) / Math.max(1, p.baselineWindowDays / p.currentWindowDays);
    return { dependencyAvailable: true, currentValue: cur?.n ?? 0, baselineValue: Math.round(baselinePerWindow), currentSample: cur?.n ?? 0, baselineSample: base?.n ?? 0, freshestAt: cur?.f ?? null, sourceType: 'orders', sourceRef: 'orders.created_at', sourceVersion: ver(cur?.f) };
  }

  private async paymentFailure(p: DecisionPolicy, now: Date): Promise<EvidenceInput> {
    const curFrom = new Date(now.getTime() - p.currentWindowDays * DAY);
    const [row] = await db.select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${orders.paymentStatus} = 'failed')::int`,
      f: sql<Date | null>`max(${orders.createdAt})`,
    }).from(orders).where(gte(orders.createdAt, curFrom));
    return { dependencyAvailable: true, currentValue: row?.failed ?? 0, baselineValue: 0, currentSample: row?.total ?? 0, baselineSample: 0, freshestAt: row?.f ?? null, sourceType: 'orders', sourceRef: 'orders.payment_status', sourceVersion: ver(row?.f) };
  }

  private async lifecycleCount(stage: string, now: Date): Promise<EvidenceInput> {
    const [row] = await db.select({
      n: sql<number>`count(*) filter (where ${customerProfiles.primaryLifecycleStage} = ${stage})::int`,
      total: sql<number>`count(*)::int`,
      f: sql<Date | null>`max(${customerProfiles.updatedAt})`,
    }).from(customerProfiles);
    return { dependencyAvailable: true, currentValue: row?.n ?? 0, baselineValue: 0, currentSample: row?.total ?? 0, baselineSample: 0, freshestAt: row?.f ?? null, sourceType: 'customer_profiles', sourceRef: `stage=${stage}`, sourceVersion: ver(row?.f) };
  }

  private async nbaNoAction(p: DecisionPolicy, now: Date): Promise<EvidenceInput> {
    const curFrom = new Date(now.getTime() - p.currentWindowDays * DAY);
    const [row] = await db.select({
      total: sql<number>`count(*)::int`,
      noAction: sql<number>`count(*) filter (where ${nbaDecisions.selectedAction} = 'NO_ACTION')::int`,
      f: sql<Date | null>`max(${nbaDecisions.createdAt})`,
    }).from(nbaDecisions).where(gte(nbaDecisions.createdAt, curFrom));
    return { dependencyAvailable: true, currentValue: row?.noAction ?? 0, baselineValue: 0, currentSample: row?.total ?? 0, baselineSample: 0, freshestAt: row?.f ?? null, sourceType: 'nba_decisions', sourceRef: 'selected_action=NO_ACTION', sourceVersion: ver(row?.f) };
  }

  private async lowStock(now: Date): Promise<EvidenceInput> {
    const [row] = await db.select({
      n: sql<number>`count(*) filter (where ${products.reorderPoint} > 0 and ${products.stockQuantity} - ${products.reservedQuantity} <= ${products.reorderPoint})::int`,
      total: sql<number>`count(*)::int`,
    }).from(products);
    return { dependencyAvailable: true, currentValue: row?.n ?? 0, baselineValue: 0, currentSample: Math.max(1, row?.n ?? 0), baselineSample: 0, freshestAt: now, sourceType: 'products', sourceRef: 'available<=reorder_point', sourceVersion: ver(now) };
  }

  private async backorder(now: Date): Promise<EvidenceInput> {
    const [row] = await db.select({ n: sql<number>`count(distinct ${fulfilmentLines.fulfilmentTaskId})::int` }).from(fulfilmentLines).where(sql`${fulfilmentLines.backorderedQuantity} > 0`);
    return { dependencyAvailable: true, currentValue: row?.n ?? 0, baselineValue: 0, currentSample: Math.max(1, row?.n ?? 0), baselineSample: 0, freshestAt: now, sourceType: 'fulfilment_lines', sourceRef: 'backordered_quantity>0', sourceVersion: ver(now) };
  }

  private async unassigned(now: Date): Promise<EvidenceInput> {
    const [row] = await db.select({ n: sql<number>`count(*)::int`, f: sql<Date | null>`max(${fulfilmentTasks.createdAt})` })
      .from(fulfilmentTasks).where(and(isNull(fulfilmentTasks.assignedTo), sql`${fulfilmentTasks.status} not in ('DELIVERED','CANCELLED')`));
    return { dependencyAvailable: true, currentValue: row?.n ?? 0, baselineValue: 0, currentSample: Math.max(1, row?.n ?? 0), baselineSample: 0, freshestAt: row?.f ?? now, sourceType: 'fulfilment_tasks', sourceRef: 'assigned_to is null & active', sourceVersion: ver(row?.f ?? now) };
  }

  private async slaBreach(now: Date): Promise<EvidenceInput> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(fulfilmentTasks)
      .where(and(sql`${fulfilmentTasks.status} not in ('DELIVERED','CANCELLED')`, lt(fulfilmentTasks.slaDueAt, now)));
    return { dependencyAvailable: true, currentValue: row?.n ?? 0, baselineValue: 0, currentSample: Math.max(1, row?.n ?? 0), baselineSample: 0, freshestAt: now, sourceType: 'fulfilment_tasks', sourceRef: 'sla_due_at<now & active', sourceVersion: ver(now) };
  }

  private async deliveryFailure(p: DecisionPolicy, now: Date): Promise<EvidenceInput> {
    const curFrom = new Date(now.getTime() - p.currentWindowDays * DAY);
    const [row] = await db.select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${fulfilmentDeliveries.outcome} in ('DELIVERY_FAILED','RETURN_TO_ORIGIN'))::int`,
      f: sql<Date | null>`max(${fulfilmentDeliveries.createdAt})`,
    }).from(fulfilmentDeliveries).where(gte(fulfilmentDeliveries.createdAt, curFrom));
    return { dependencyAvailable: true, currentValue: row?.failed ?? 0, baselineValue: 0, currentSample: row?.total ?? 0, baselineSample: 0, freshestAt: row?.f ?? null, sourceType: 'fulfilment_deliveries', sourceRef: 'failed/RTO outcomes', sourceVersion: ver(row?.f) };
  }

  private async zeroResultSearch(p: DecisionPolicy, now: Date): Promise<EvidenceInput> {
    const curFrom = new Date(now.getTime() - p.currentWindowDays * DAY);
    const baseFrom = new Date(now.getTime() - (p.currentWindowDays + p.baselineWindowDays) * DAY);
    const [cur] = await db.select({ zr: sql<number>`coalesce(sum(${searchDemandSignals.zeroResultCount}),0)::int`, sc: sql<number>`coalesce(sum(${searchDemandSignals.searchCount}),0)::int`, f: sql<Date | null>`max(${searchDemandSignals.lastSearchedAt})` })
      .from(searchDemandSignals).where(gte(searchDemandSignals.lastSearchedAt, curFrom));
    const [base] = await db.select({ zr: sql<number>`coalesce(sum(${searchDemandSignals.zeroResultCount}),0)::int` })
      .from(searchDemandSignals).where(and(gte(searchDemandSignals.lastSearchedAt, baseFrom), lt(searchDemandSignals.lastSearchedAt, curFrom)));
    const baselinePerWindow = (base?.zr ?? 0) / Math.max(1, p.baselineWindowDays / p.currentWindowDays);
    return { dependencyAvailable: true, currentValue: cur?.zr ?? 0, baselineValue: Math.round(baselinePerWindow), currentSample: cur?.sc ?? 0, baselineSample: base?.zr ?? 0, freshestAt: cur?.f ?? null, sourceType: 'search_demand_signals', sourceRef: 'zero_result_count', sourceVersion: ver(cur?.f) };
  }
}
