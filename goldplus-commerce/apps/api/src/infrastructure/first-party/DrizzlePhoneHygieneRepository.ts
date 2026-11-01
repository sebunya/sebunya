import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { IPhoneHygieneRepository } from '../../application/ports/first-party/FirstPartyPorts';
import type { PlannedNormalisation, StoredPhone, PhoneTable } from '../../domain/first-party/PhoneHygiene';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

/**
 * The phone columns the hygiene script reads, as (table, column, owner). A
 * fixed allowlist: table and column names are never taken from input.
 */
const COLUMNS: Array<{ table: PhoneTable; column: string; owner: string | null }> = [
  { table: 'users', column: 'phone', owner: 'id' },
  { table: 'orders', column: 'customer_phone', owner: 'user_id' },
  { table: 'addresses', column: 'phone', owner: 'user_id' },
  { table: 'addresses', column: 'phone_secondary', owner: 'user_id' },
  { table: 'quote_requests', column: 'phone', owner: null },
  { table: 'dealer_applications', column: 'phone', owner: null },
];

export class DrizzlePhoneHygieneRepository implements IPhoneHygieneRepository {
  async loadAll(): Promise<StoredPhone[]> {
    const out: StoredPhone[] = [];
    for (const c of COLUMNS) {
      const owner = c.owner ? sql.raw(`${c.owner}::text`) : sql`null::text`;
      const r = rows(await db.execute(sql`select id::text as id, ${sql.raw(c.column)} as raw, ${owner} as owner
        from ${sql.raw(c.table)} where ${sql.raw(c.column)} is not null and ${sql.raw(c.column)} <> ''`));
      for (const x of r) out.push({ table: c.table, column: c.column, rowId: String(x.id), raw: String(x.raw), accountUserId: x.owner ? String(x.owner) : null });
    }
    return out;
  }

  async applyNormalisation(runId: string, n: PlannedNormalisation): Promise<boolean> {
    const col = COLUMNS.find((c) => c.table === n.table && c.column === n.column);
    if (!col) throw new Error('PHONE_COLUMN_NOT_ALLOWLISTED');
    return db.transaction(async (tx) => {
      // Optimistic: only if the stored value is still what the plan saw.
      const updated = rows(await tx.execute(sql`update ${sql.raw(col.table)} set ${sql.raw(col.column)} = ${n.to}
        where id = ${n.rowId}::uuid and ${sql.raw(col.column)} = ${n.from} returning id`));
      if (updated.length === 0) return false;
      await tx.execute(sql`insert into phone_normalisation_log (run_id, table_name, column_name, row_id, previous_value, new_value)
        values (${runId}::uuid, ${col.table}, ${col.column}, ${n.rowId}::uuid, ${n.from.slice(0, 50)}, ${n.to})`);
      return true;
    });
  }

  /** Put every value a run changed back (only where it is still the new value). */
  async revertRun(runId: string): Promise<{ reverted: number; skipped: number }> {
    const log = rows(await db.execute(sql`select id, table_name, column_name, row_id, previous_value, new_value from phone_normalisation_log
      where run_id = ${runId}::uuid and reverted_at is null`));
    let reverted = 0;
    let skipped = 0;
    for (const l of log) {
      const col = COLUMNS.find((c) => c.table === l.table_name && c.column === l.column_name);
      if (!col) { skipped++; continue; }
      const ok = await db.transaction(async (tx) => {
        const u = rows(await tx.execute(sql`update ${sql.raw(col.table)} set ${sql.raw(col.column)} = ${String(l.previous_value)}
          where id = ${String(l.row_id)}::uuid and ${sql.raw(col.column)} = ${String(l.new_value)} returning id`));
        if (u.length === 0) return false;
        await tx.execute(sql`update phone_normalisation_log set reverted_at = now() where id = ${String(l.id)}::uuid`);
        return true;
      }).catch(() => false);
      if (ok) reverted++; else skipped++;
    }
    return { reverted, skipped };
  }
}
