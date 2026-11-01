import { sql } from 'drizzle-orm';
import { db } from '../client';
import { pgJsonb } from '../PgParams';
import type { AdDestinationRepository, AdDestinationRow } from '../../../application/ports/Advertising';

const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const map = (r: any): AdDestinationRow => ({
  platform: r.platform, enabled: !!r.enabled, config: (typeof r.config === 'string' ? JSON.parse(r.config) : r.config) ?? {},
  hasSecret: !!r.secret_enc, secretMask: r.secret_mask ?? null, updatedAt: iso(r.updated_at),
  lastSuccessAt: iso(r.last_success_at), lastError: r.last_error ?? null, lastErrorAt: iso(r.last_error_at),
  sentCount: Number(r.sent_count ?? 0), failedCount: Number(r.failed_count ?? 0),
  // 0154 columns; absent before the migration runs (read as the old behaviour).
  mode: r.mode === 'test' ? 'test' : 'live',
  eventSelection: parseSelection(r.event_selection),
});
function parseSelection(v: unknown): string[] | null {
  const a = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  return Array.isArray(a) ? a.map(String) : null;
}

export class DrizzleAdDestinationRepository implements AdDestinationRepository {
  async list() { return rowsOf(await db.execute(sql`select * from ad_destinations order by platform`)).map(map); }
  async get(platform: string) { const r = rowsOf(await db.execute(sql`select * from ad_destinations where platform = ${platform}`))[0]; return r ? map(r) : null; }
  async save(platform: string, p: { enabled?: boolean; config?: Record<string, string>; secretEnc?: string | null; secretMask?: string | null; updatedBy: string | null; mode?: 'live' | 'test'; eventSelection?: string[] | null }) {
    const by = p.updatedBy && UUID.test(p.updatedBy) ? sql`${p.updatedBy}::uuid` : sql`null`;
    const r = rowsOf(await db.execute(sql`
      insert into ad_destinations (platform, enabled, config, secret_enc, secret_mask, updated_by, updated_at)
      values (${platform}, ${p.enabled ?? false}, ${pgJsonb(p.config ?? {})}, ${p.secretEnc ?? null}, ${p.secretMask ?? null}, ${by}, now())
      on conflict (platform) do update set
        enabled = ${p.enabled === undefined ? sql`ad_destinations.enabled` : sql`${p.enabled}`},
        config = ${p.config === undefined ? sql`ad_destinations.config` : pgJsonb(p.config)},
        secret_enc = ${p.secretEnc === undefined ? sql`ad_destinations.secret_enc` : sql`${p.secretEnc}`},
        secret_mask = ${p.secretMask === undefined ? sql`ad_destinations.secret_mask` : sql`${p.secretMask}`},
        updated_by = ${by}, updated_at = now()
      returning *`))[0];
    // 0154 settings in their own statement, only when given: a save before the
    // migration (or one that does not touch them) never references the columns.
    if (p.mode !== undefined || p.eventSelection !== undefined) {
      const r2 = rowsOf(await db.execute(sql`update ad_destinations set
          mode = ${p.mode === undefined ? sql`mode` : sql`${p.mode}`},
          event_selection = ${p.eventSelection === undefined ? sql`event_selection` : p.eventSelection === null ? sql`null` : pgJsonb(p.eventSelection)}
        where platform = ${platform} returning *`))[0];
      return map(r2 ?? r);
    }
    return map(r);
  }
  async active() {
    // Postback platforms carry no token; completeness is enforced when switched on.
    // select *: before 0154 the mode/event_selection columns do not exist yet.
    return rowsOf(await db.execute(sql`select * from ad_destinations where enabled`))
      .map((r) => {
        const config = (typeof r.config === 'string' ? JSON.parse(r.config) : r.config) ?? {};
        // Test mode reaches every builder through the config it already takes.
        return { platform: r.platform, config: r.mode === 'test' ? { ...config, _test: '1' } : config, secretEnc: r.secret_enc, eventSelection: parseSelection(r.event_selection) };
      });
  }
  /** The encrypted token of one destination, whether or not it is switched on (0154 capabilities borrow it). */
  async secretEnc(platform: string): Promise<string | null> {
    const r = rowsOf(await db.execute(sql`select secret_enc from ad_destinations where platform = ${platform}`))[0];
    return r?.secret_enc ?? null;
  }
  async recordResult(platform: string, ok: boolean, error?: string) {
    await db.execute(ok
      ? sql`update ad_destinations set last_success_at = now(), sent_count = sent_count + 1 where platform = ${platform}`
      : sql`update ad_destinations set last_error = ${String(error ?? '').slice(0, 500)}, last_error_at = now(), failed_count = failed_count + 1 where platform = ${platform}`);
  }
}
