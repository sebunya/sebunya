import { sql } from 'drizzle-orm';
import { db } from '../client';
import {
  CalibrationProposal,
  ICalibrationRepository,
} from '../../../application/use-cases/delivery/DeliveryCalibrationUseCases';
import { IDeliveryReportRepository } from '../../../application/use-cases/delivery/DeliveryReportUseCases';
import { Observation } from '../../../domain/delivery/DeliveryCalibration';
import { FactorKind } from '../../../domain/delivery/DeliveryLearnedFactor';

/**
 * Calibration reads and writes.
 *
 * `allObservations` returns EVERYTHING, every run. The statelessness rule
 * depends on it: a run that read only "since last time" could not correct a bad
 * night, and running twice would not be a no-op.
 *
 * NO SYNTHETIC DATA. Nothing here writes an observation. Observations arrive
 * only from real deliveries through the capture path.
 */
export class DrizzleDeliveryCalibrationRepository implements ICalibrationRepository, IDeliveryReportRepository {
  async allObservations(): Promise<Observation[]> {
    const rows = (await db.execute(sql`
      select area_slug, corridor, expected_minutes, actual_minutes, distance_travelled_km,
             had_pin, quoted_fee_ugx, final_fee_ugx, actual_rider_cost_ugx, variance_reason,
             dispatched_at
      from delivery_quote_capture
      where delivered_at is not null`)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      areaSlug: r.area_slug === null ? null : String(r.area_slug),
      corridor: r.corridor === null ? null : String(r.corridor),
      // Hour of week is derived at capture time from the EAT clock, not
      // recomputed here from a UTC timestamp.
      eatHourOfWeek: null,
      predictedMinutes: r.expected_minutes === null ? null : Number(r.expected_minutes),
      actualMinutes: r.actual_minutes === null ? null : Number(r.actual_minutes),
      straightLineKm: null,
      distanceTravelledKm: r.distance_travelled_km === null ? null : Number(r.distance_travelled_km),
      hadPin: r.had_pin === null ? null : Boolean(r.had_pin),
      quotedFeeUgx: r.quoted_fee_ugx === null ? null : Number(r.quoted_fee_ugx),
      finalFeeUgx: r.final_fee_ugx === null ? null : Number(r.final_fee_ugx),
      actualRiderCostUgx: r.actual_rider_cost_ugx === null ? null : Number(r.actual_rider_cost_ugx),
      varianceReason: r.variance_reason === null ? null : String(r.variance_reason),
    }));
  }

  async counts() {
    const [row] = (await db.execute(sql`
      select
        (select count(*) from delivery_quote_capture where delivered_at is not null)::int as observations,
        (select count(*) from orders where status = 'delivered')::int as delivered_orders,
        (select count(*) from delivery_quote_capture where actual_rider_cost_ugx is not null)::int as rider_costs,
        (select count(*) from audit_logs where action = 'FULFILMENT_DELIVERY_RECORDED'
           and new_state->>'orderTransition' = 'skipped')::int as skipped_mirrors`)) as unknown as Array<{
      observations: number;
      delivered_orders: number;
      rider_costs: number;
      skipped_mirrors: number;
    }>;
    return {
      observations: row?.observations ?? 0,
      deliveredOrders: row?.delivered_orders ?? 0,
      riderCostsRecorded: row?.rider_costs ?? 0,
      skippedMirrors: row?.skipped_mirrors ?? 0,
    };
  }

  async scopes() {
    const rows = (await db.execute(sql`
      select distinct corridor, area_slug from delivery_quote_capture where delivered_at is not null`)) as unknown as Array<{
      corridor: string | null;
      area_slug: string | null;
    }>;
    return {
      corridors: [...new Set(rows.map((r) => r.corridor).filter((v): v is string => Boolean(v)))],
      areas: [...new Set(rows.map((r) => r.area_slug).filter((v): v is string => Boolean(v)))],
      hours: [],
    };
  }

  async currentFactor(kind: FactorKind, scopeKey: string) {
    const rows = (await db.execute(sql`
      select value, sample_size, origin from delivery_learned_factor
      where factor_kind = ${kind} and scope_key = ${scopeKey} limit 1`)) as unknown as Array<{
      value: string;
      sample_size: number;
      origin: string;
    }>;
    const r = rows[0];
    return r ? { value: Number(r.value), sampleSize: r.sample_size, origin: r.origin } : null;
  }

  /**
   * Replace every PENDING proposal wholesale.
   *
   * That is what makes a run idempotent: two identical runs leave identical
   * rows, and a bad night's output cannot accumulate alongside a good one's.
   * Decided proposals are untouched, because their decision is history.
   */
  async replacePendingProposals(proposals: Array<Omit<CalibrationProposal, 'id' | 'createdAt'>>): Promise<number> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`delete from delivery_calibration_proposal where status = 'pending'`);
      for (const p of proposals) {
        await tx.execute(sql`
          insert into delivery_calibration_proposal
            (factor_kind, scope_key, current_value, current_state, proposed_value, sample_size, fee_impact_ugx, status)
          values (${p.factorKind}, ${p.scopeKey}, ${p.currentValue}, ${p.currentState},
                  ${p.proposedValue}, ${p.sampleSize}, ${p.feeImpactUgx}, 'pending')`);
      }
      return proposals.length;
    });
  }

  async listProposals(status: string, limit: number): Promise<CalibrationProposal[]> {
    const rows = (await db.execute(sql`
      select id, factor_kind, scope_key, current_value, current_state, proposed_value,
             sample_size, fee_impact_ugx, status, created_at
      from delivery_calibration_proposal
      where status = ${status} order by created_at desc limit ${limit}`)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      factorKind: String(r.factor_kind) as FactorKind,
      scopeKey: String(r.scope_key),
      currentValue: r.current_value === null ? null : Number(r.current_value),
      currentState: String(r.current_state) as CalibrationProposal['currentState'],
      proposedValue: Number(r.proposed_value),
      sampleSize: Number(r.sample_size),
      feeImpactUgx: r.fee_impact_ugx === null ? null : Number(r.fee_impact_ugx),
      status: String(r.status) as CalibrationProposal['status'],
      createdAt: new Date(String(r.created_at)),
    }));
  }

  async findProposal(id: string): Promise<CalibrationProposal | null> {
    const rows = await this.listProposalsById(id);
    return rows[0] ?? null;
  }

  private async listProposalsById(id: string): Promise<CalibrationProposal[]> {
    const rows = (await db.execute(sql`
      select id, factor_kind, scope_key, current_value, current_state, proposed_value,
             sample_size, fee_impact_ugx, status, created_at
      from delivery_calibration_proposal where id = ${id} limit 1`)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      factorKind: String(r.factor_kind) as FactorKind,
      scopeKey: String(r.scope_key),
      currentValue: r.current_value === null ? null : Number(r.current_value),
      currentState: String(r.current_state) as CalibrationProposal['currentState'],
      proposedValue: Number(r.proposed_value),
      sampleSize: Number(r.sample_size),
      feeImpactUgx: r.fee_impact_ugx === null ? null : Number(r.fee_impact_ugx),
      status: String(r.status) as CalibrationProposal['status'],
      createdAt: new Date(String(r.created_at)),
    }));
  }

  async setProposalStatus(input: { id: string; status: CalibrationProposal['status']; actorId: string }) {
    await db.execute(sql`
      update delivery_calibration_proposal
      set status = ${input.status}, decided_by = ${input.actorId}, decided_at = now()
      where id = ${input.id}`);
  }

  async writeFactor(input: {
    kind: FactorKind;
    scopeKey: string;
    value: number;
    sampleSize: number;
    origin: 'fitted' | 'human';
    actorId: string;
  }) {
    await db.execute(sql`
      insert into delivery_learned_factor (factor_kind, scope_key, value, sample_size, origin, set_by, updated_at)
      values (${input.kind}, ${input.scopeKey}, ${input.value}, ${input.sampleSize}, ${input.origin},
              ${input.origin === 'human' ? input.actorId : null}, now())
      on conflict (factor_kind, scope_key) do update set
        value = excluded.value,
        sample_size = excluded.sample_size,
        origin = excluded.origin,
        set_by = excluded.set_by,
        updated_at = now()`);
  }

  async areasWithMeasuredDistances() {
    const rows = (await db.execute(sql`
      select c.area_slug, c.distance_band, array_agg(q.distance_travelled_km) as kms
      from delivery_quote_capture q
      join delivery_corridor c on c.area_slug = q.area_slug
      where q.distance_travelled_km is not null
      group by c.area_slug, c.distance_band`)) as unknown as Array<{
      area_slug: string;
      distance_band: string;
      kms: Array<string | number>;
    }>;
    return rows.map((r) => ({
      areaSlug: r.area_slug,
      seededBand: r.distance_band,
      // Halved: the capture records the round trip, the band is one way.
      measuredKm: (r.kms ?? []).map((k) => Number(k) / 2).filter((k) => Number.isFinite(k)),
    }));
  }

  async firstObservationAlertFired(): Promise<boolean> {
    const rows = (await db.execute(
      sql`select 1 from delivery_calibration_milestone where milestone = 'first_observation' limit 1`,
    )) as unknown as unknown[];
    return rows.length > 0;
  }

  async markFirstObservationAlertFired(input: { orderId: string; at: Date }) {
    await db.execute(sql`
      insert into delivery_calibration_milestone (milestone, order_id, fired_at, note)
      values ('first_observation', ${input.orderId}, ${input.at},
              'The delivery model has its first real observation. It is no longer theoretical.')
      on conflict (milestone) do nothing`);
  }

  async firstObservation() {
    const rows = (await db.execute(sql`
      select order_id, area_slug, delivered_at from delivery_quote_capture
      where actual_rider_cost_ugx is not null and delivered_at is not null
      order by delivered_at asc limit 1`)) as unknown as Array<{
      order_id: string;
      area_slug: string | null;
      delivered_at: string;
    }>;
    const r = rows[0];
    return r ? { orderId: r.order_id, areaSlug: r.area_slug, at: new Date(r.delivered_at) } : null;
  }

  /* ── Report reads ─────────────────────────────────────────────────────── */

  async marginByArea() {
    return (await db.execute(sql`
      select area_slug,
             count(*)::int as deliveries,
             sum(coalesce(final_fee_ugx, quoted_fee_ugx))::bigint as charged_ugx,
             sum(actual_rider_cost_ugx)::bigint as cost_ugx
      from delivery_quote_capture
      where actual_rider_cost_ugx is not null
      group by area_slug order by area_slug`)) as unknown as Array<{
      area_slug: string | null;
      deliveries: number;
      charged_ugx: string | number | null;
      cost_ugx: string | number | null;
    }>;
  }

  async varianceByReason() {
    return (await db.execute(sql`
      select reason,
             count(*)::int as n,
             count(*) filter (where disposition = 'absorbed')::int as absorbed,
             coalesce(sum(delta_ugx) filter (where disposition = 'absorbed'), 0)::bigint as absorbed_ugx,
             count(*) filter (where disposition = 'needs_agreement')::int as needs_agreement,
             count(*) filter (where agreement = 'agreed')::int as agreed,
             count(*) filter (where agreement = 'declined')::int as declined,
             coalesce(sum(delta_ugx), 0)::bigint as total_delta
      from delivery_fee_variance
      group by reason order by n desc`)) as unknown as Array<Record<string, unknown>>;
  }

  async pricedByBreakdown() {
    return (await db.execute(sql`
      select priced_by, count(*)::int as n from delivery_quote_capture group by priced_by`)) as unknown as Array<{
      priced_by: string | null;
      n: number;
    }>;
  }
}
