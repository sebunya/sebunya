import { sql } from 'drizzle-orm';
import { db } from '../db/client';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface CreatorCostRow { id: string; creatorId: string; handle: string; label: string; amountUgx: number; startDate: string; endDate: string; note: string | null; createdAt: string; overlapsContractFee: boolean }
export interface CreatorCostInput { creatorId: string; label: string; amountUgx: number; startDate: string; endDate: string; note: string | null; actorId: string }

/** creator_negotiated_costs (0204): what the owner agreed to pay a creator outside a contract record. */
export class DrizzleCreatorCostStore {
  async creators(): Promise<Array<{ id: string; handle: string; status: string }>> {
    return rows(await db.execute(sql`select id, handle, status from creators order by (status = 'active') desc, handle`)).map((r) => ({ id: String(r.id), handle: String(r.handle), status: String(r.status) }));
  }

  async list(days = 400): Promise<CreatorCostRow[]> {
    // overlaps: the same creator has a contract flat fee (already counted by the nightly) over any of these days,
    // so the page can warn that the two may be the same money.
    return rows(await db.execute(sql`select n.id, n.creator_id, c.handle, n.label, n.amount_ugx, n.start_date::text as start_date, n.end_date::text as end_date, n.note, n.created_at,
        exists (select 1 from creator_contracts k where k.creator_id = n.creator_id and k.flat_fee_ugx > 0 and k.status in ('active', 'paused', 'blocked')
          and k.start_date is not null and k.end_date is not null and k.start_date <= n.end_date and k.end_date >= n.start_date) as overlaps
      from creator_negotiated_costs n join creators c on c.id = n.creator_id
      where n.deleted_at is null and n.end_date >= current_date - ${days}::int order by n.start_date desc, n.created_at desc`))
      .map((r) => ({ id: String(r.id), creatorId: String(r.creator_id), handle: String(r.handle), label: String(r.label), amountUgx: Number(r.amount_ugx), startDate: String(r.start_date), endDate: String(r.end_date), note: r.note ?? null, createdAt: new Date(r.created_at).toISOString(), overlapsContractFee: Boolean(r.overlaps) }));
  }

  async add(input: CreatorCostInput): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(input.creatorId)) return { ok: false, message: 'Choose a creator.' };
    const label = input.label.trim();
    if (!label || label.length > 120) return { ok: false, message: 'Say what the payment was for, in up to 120 characters.' };
    if (!Number.isInteger(input.amountUgx) || input.amountUgx <= 0 || input.amountUgx > 500_000_000) return { ok: false, message: 'The amount is whole shillings above zero.' };
    if (!DAY.test(input.startDate) || !DAY.test(input.endDate)) return { ok: false, message: 'Dates are YYYY-MM-DD.' };
    if (input.endDate < input.startDate) return { ok: false, message: 'The end date cannot be before the start date.' };
    const exists = rows(await db.execute(sql`select 1 from creators where id = ${input.creatorId}::uuid`)).length > 0;
    if (!exists) return { ok: false, message: 'That creator does not exist.' };
    const r = rows(await db.execute(sql`insert into creator_negotiated_costs (creator_id, label, amount_ugx, start_date, end_date, note, created_by)
      values (${input.creatorId}::uuid, ${label}, ${input.amountUgx}, ${input.startDate}::date, ${input.endDate}::date, ${input.note ? input.note.slice(0, 300) : null}, ${input.actorId || null}::uuid) returning id`))[0];
    return { ok: true, id: String(r.id) };
  }

  async end(id: string, actorId: string): Promise<{ ok: true; wasLive: boolean } | { ok: false; message: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: 'Unknown cost row.' };
    const r = rows(await db.execute(sql`update creator_negotiated_costs set deleted_at = now(), deleted_by = ${actorId || null}::uuid where id = ${id}::uuid and deleted_at is null returning id`));
    return { ok: true, wasLive: r.length > 0 };
  }
}
