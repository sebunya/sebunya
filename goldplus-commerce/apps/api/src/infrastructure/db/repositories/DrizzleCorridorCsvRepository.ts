import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IAuditRepository } from '../../../application/ports/IAuditRepository';
import { CorridorChangedError, type ICorridorCsvRepository } from '../../../application/use-cases/delivery/DeliveryCorridorCsvUseCase';

/**
 * The corridor table's side of the CSV round trip: the current rows for the dry
 * run, the compare-and-set apply, and the audited batch a revert undoes.
 *
 * Moved out of the Registry, 2026-11: the queries and the row mapping are
 * exactly those the Registry held.
 */
export class DrizzleCorridorCsvRepository implements ICorridorCsvRepository {
  constructor(private readonly auditRepo: Pick<IAuditRepository, 'findByEntity'>) {}

  // Compare-and-set per field under the corridor write lock (the parish import takes the same lock): a row that
  // no longer carries its `from` value aborts the whole batch, so the audit row is always true.
  async applyChanges(changes: Array<{ areaSlug: string; field: string; from: string; to: string }>) {
    const rowCount = (r: unknown) => Number((r as { count?: number })?.count ?? 0);
    const areas = new Set<string>();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('delivery_corridor_apply'))`);
      for (const ch of changes) {
        const slug = ch.areaSlug;
        let r: unknown;
        switch (ch.field) {
          case 'corridor':
            r = await tx.execute(sql`update delivery_corridor set corridor = ${ch.to}, data_version = data_version + 1, updated_at = now()
              where area_slug = ${slug} and corridor = ${ch.from}`);
            break;
          case 'distance_band':
            r = await tx.execute(sql`update delivery_corridor set distance_band = ${ch.to}, data_version = data_version + 1, updated_at = now()
              where area_slug = ${slug} and distance_band = ${ch.from}`);
            break;
          case 'access_mode':
            r = await tx.execute(sql`update delivery_corridor set access_mode = ${ch.to}, data_version = data_version + 1, updated_at = now()
              where area_slug = ${slug} and access_mode = ${ch.from}`);
            break;
          case 'serviceable':
            r = await tx.execute(sql`update delivery_corridor set serviceable = ${ch.to === 'true'}, data_version = data_version + 1, updated_at = now()
              where area_slug = ${slug} and serviceable = ${ch.from === 'true'}`);
            break;
          case 'fulfilment_mode': {
            const to = ch.to === '(derived)' ? null : ch.to;
            const from = ch.from === '(derived)' ? null : ch.from;
            r = await tx.execute(sql`update delivery_corridor set fulfilment_mode = ${to}, data_version = data_version + 1, updated_at = now()
              where area_slug = ${slug} and fulfilment_mode is not distinct from ${from}`);
            break;
          }
          default:
            throw new Error(`corridor apply: unknown field ${ch.field}`);
        }
        if (rowCount(r) !== 1) throw new CorridorChangedError(slug);
        areas.add(slug);
      }
    });
    return areas.size;
  }

  async findBatch(batchId: string) {
    const rows = await this.auditRepo.findByEntity('delivery_corridor_batch', batchId);
    const applied = rows.find((r) => r.action === 'DELIVERY_CORRIDORS_APPLIED');
    const state = (applied as { newState?: { changes?: Array<{ areaSlug: string; field: string; from: string; to: string }>; reason?: string } } | undefined)?.newState;
    if (!state?.changes) return null;
    return { changes: state.changes, reason: state.reason ?? null };
  }

  async currentCorridors() {
    const rows = (await db.execute(sql`
      select area_slug, corridor, distance_band, access_mode, serviceable, fulfilment_mode
      from delivery_corridor`)) as unknown as Array<Record<string, unknown>>;
    return new Map(
      rows.map((r) => [
        String(r.area_slug),
        {
          areaSlug: String(r.area_slug),
          corridor: String(r.corridor),
          distanceBand: String(r.distance_band),
          accessMode: String(r.access_mode),
          serviceable: Boolean(r.serviceable),
          fulfilmentMode: r.fulfilment_mode === null ? null : String(r.fulfilment_mode),
        },
      ]),
    );
  }
}
