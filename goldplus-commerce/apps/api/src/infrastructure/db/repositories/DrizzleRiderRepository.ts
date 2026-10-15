import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IRiderRepository, RiderRow } from '../../../application/use-cases/delivery/RiderUseCases';

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] })?.rows ?? []));
const toRow = (x: Row): RiderRow => ({
  id: String(x.id),
  name: String(x.name),
  phoneE164: String(x.phone_e164),
  active: Boolean(x.active),
  createdAt: new Date(String(x.created_at)),
});

export class DrizzleRiderRepository implements IRiderRepository {
  async list(): Promise<RiderRow[]> {
    return rows(await db.execute(sql`select id, name, phone_e164, active, created_at from delivery_riders order by active desc, name`)).map(toRow);
  }

  async create(input: { name: string; phoneE164: string; addedBy: string | null }): Promise<RiderRow> {
    const r = rows(await db.execute(sql`
      insert into delivery_riders (name, phone_e164, added_by) values (${input.name}, ${input.phoneE164}, ${input.addedBy})
      returning id, name, phone_e164, active, created_at`));
    return toRow(r[0]);
  }

  async setActive(id: string, active: boolean): Promise<boolean> {
    const r = (await db.execute(sql`update delivery_riders set active = ${active}, updated_at = now() where id = ${id}`)) as unknown as { count?: number };
    return Number(r?.count ?? 0) === 1;
  }
}
