import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { HoldoutStore } from '../../application/use-cases/measurement/HoldoutGate';
import { HOLDOUT_PROGRAMMES, liftSummary, type HoldoutArm, type LiftSummary } from '../../domain/measurement/Incrementality';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
export const OUTCOME_WINDOWS_DAYS = [14, 28] as const;

export interface HoldoutWaveView {
  programme: string;
  waveKey: string;
  windowDays: number;
  /** The wave is still accumulating buyers: its last assignment is younger than the window. */
  maturing: boolean;
  computedAt: string | null;
  lift: LiftSummary;
}

/**
 * A buyer is a treated or held person with a sale after their assignment and within the window. The person is the
 * user id or, for guests, the sha256 of the phone digits with a leading 0 rewritten as 256 (HoldoutGate.phoneKey).
 */
const SALE = sql`o.status not in ('cancelled','failed','delivery_failed') and (o.payment_method is distinct from 'pesapal' or o.payment_status = 'paid')`;
const PHONE_KEY = sql`'phone:' || encode(sha256(convert_to(regexp_replace(regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g'), '^0', '256'), 'UTF8')), 'hex')`;

export class DrizzleHoldoutStore implements HoldoutStore {
  private cachedSalt: string | null = null;

  async salt(): Promise<string> {
    if (this.cachedSalt) return this.cachedSalt;
    const r = rows(await db.execute(sql`select config_value from measurement.config where config_key = 'holdout_salt'`))[0];
    if (!r) throw new Error('holdout_salt missing from measurement.config (migration 0203)');
    this.cachedSalt = String(r.config_value);
    return this.cachedSalt;
  }

  async recordAssignment(row: { programme: string; waveKey: string; subjectRef: string; customerKey: string; arm: HoldoutArm; channel: string | null; at: Date }): Promise<HoldoutArm> {
    const r = rows(await db.execute(sql`insert into measurement.holdout_assignment (programme, wave_key, subject_ref, customer_key, arm, channel, assigned_at)
      values (${row.programme}, ${row.waveKey}, ${row.subjectRef}, ${row.customerKey}, ${row.arm}, ${row.channel}, ${row.at})
      on conflict (programme, wave_key, subject_ref) do update set subject_ref = excluded.subject_ref returning arm`))[0];
    return (r?.arm === 'hold' ? 'hold' : 'treat');
  }

  /** Recompute every wave's outcome under each window; cheap (one aggregate per programme × window). */
  async computeOutcomes(now = new Date()): Promise<number> {
    let written = 0;
    for (const windowDays of OUTCOME_WINDOWS_DAYS) {
      const out = rows(await db.execute(sql`
        with a as (
          select programme, wave_key, arm, customer_key, min(assigned_at) as assigned_at
          from measurement.holdout_assignment group by 1, 2, 3, 4
        ), sales as (
          select a.programme, a.wave_key, a.arm, a.customer_key, count(o.id)::int as orders,
                 coalesce(sum(greatest(o.total_amount - coalesce(o.delivery_fee, 0), 0)), 0)::bigint as revenue
          from a left join orders o on (${SALE}) and o.created_at > a.assigned_at and o.created_at <= a.assigned_at + make_interval(days => ${windowDays})
            and (a.customer_key = 'user:' || coalesce(o.user_id::text, '') or a.customer_key = ${PHONE_KEY})
          group by 1, 2, 3, 4
        )
        select programme, wave_key, arm, count(*)::int as subjects, count(*) filter (where orders > 0)::int as buyers,
               sum(orders)::int as orders, sum(revenue)::bigint as revenue
        from sales group by 1, 2, 3`));
      for (const r of out) {
        await db.execute(sql`insert into measurement.holdout_outcome (programme, wave_key, arm, window_days, subjects, buyers, orders, revenue_minor, computed_at)
          values (${r.programme}, ${r.wave_key}, ${r.arm}, ${windowDays}, ${r.subjects}, ${r.buyers}, ${r.orders}, ${String(r.revenue)}, ${now})
          on conflict (programme, wave_key, arm, window_days) do update set subjects = excluded.subjects, buyers = excluded.buyers, orders = excluded.orders, revenue_minor = excluded.revenue_minor, computed_at = excluded.computed_at`);
        written++;
      }
    }
    return written;
  }

  async results(now = new Date()): Promise<HoldoutWaveView[]> {
    const o = rows(await db.execute(sql`select programme, wave_key, arm, window_days, subjects, buyers, orders, revenue_minor, computed_at from measurement.holdout_outcome order by programme, wave_key desc, window_days`));
    const last = rows(await db.execute(sql`select programme, wave_key, max(assigned_at) as last_at from measurement.holdout_assignment group by 1, 2`));
    const lastAt = new Map(last.map((r) => [`${r.programme}|${r.wave_key}`, new Date(r.last_at)]));
    const byWave = new Map<string, { programme: string; waveKey: string; windowDays: number; computedAt: string | null; treat?: any; hold?: any }>();
    for (const r of o) {
      const k = `${r.programme}|${r.wave_key}|${r.window_days}`;
      const w = byWave.get(k) ?? { programme: String(r.programme), waveKey: String(r.wave_key), windowDays: Number(r.window_days), computedAt: r.computed_at ? new Date(r.computed_at).toISOString() : null };
      w[r.arm === 'hold' ? 'hold' : 'treat'] = { subjects: Number(r.subjects), buyers: Number(r.buyers), orders: Number(r.orders), revenueMinor: BigInt(String(r.revenue_minor)) };
      byWave.set(k, w);
    }
    const empty = { subjects: 0, buyers: 0, orders: 0, revenueMinor: 0n };
    return [...byWave.values()].map((w) => {
      const la = lastAt.get(`${w.programme}|${w.waveKey}`);
      return { programme: w.programme, waveKey: w.waveKey, windowDays: w.windowDays, computedAt: w.computedAt,
        maturing: !!la && now.getTime() - la.getTime() < w.windowDays * 86_400_000, lift: liftSummary(w.treat ?? empty, w.hold ?? empty) };
    });
  }

  async assignmentCounts(): Promise<Array<{ programme: string; waveKey: string; treat: number; hold: number }>> {
    const r = rows(await db.execute(sql`select programme, wave_key, count(*) filter (where arm = 'treat')::int as treat, count(*) filter (where arm = 'hold')::int as hold
      from measurement.holdout_assignment group by 1, 2 order by 2 desc, 1`));
    return r.map((x) => ({ programme: String(x.programme), waveKey: String(x.wave_key), treat: Number(x.treat), hold: Number(x.hold) }));
  }

  static programmes(): readonly string[] { return HOLDOUT_PROGRAMMES; }
}
