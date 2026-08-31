import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

/**
 * One-off. On 2026-08-31 the owner pressed "Approve all 94" on PIM import
 * 02012a56 six times; each press approved and activated the products and then
 * the audit insert threw (a bare 'bulk' into a UUID column), so the operator
 * saw an error and no audit row exists for a change that went live. This
 * writes the record that should have been written, naming the recovery.
 *
 *   ACTOR_USER_ID=<owner uuid> npx tsx src/scripts/backfill-bulk-approval-audit.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the owner uuid.');
  const ids = rowsOf(await db.execute(sql`select target_product_id as id from pim_import_rows where session_id = '02012a56-6db1-429d-a422-3651c61aec90' and status = 'APPLIED'`)).map((r) => String(r.id));
  const audit = new CreateAuditLogUseCase(Registry.getInstance().auditRepo);
  const out = await audit.execute({
    actorId, action: 'PRODUCTS_BULK_APPROVAL', entity: 'product_bulk_approval', entityId: randomUUID(),
    previousState: { approvalStatus: 'draft', active: false },
    newState: { approvalStatus: 'approved', active: true, requireStock: true, requested: ids.length, changed: ids.length, productIds: ids,
      recovery: 'Written after the fact: the owner pressed Approve all on 2026-08-31 (six attempts, ~12:00–12:20 EAT); the products were approved on the first press and the audit insert failed on a non-UUID entity id. Route fixed the same day.' },
  });
  console.log(out.ok ? `audit written ${out.id} for ${ids.length} products` : `FAILED ${JSON.stringify(out)}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
