import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { isMeasurementConfigKey, validateMeasurementValue } from '../../domain/measurement/MeasurementConfig';
import type { MeasurementConfigPort } from '../../application/ports/measurement/MeasurementConfigPort';

type Audit = (entry: { actorId: string; action: string; entity: string; entityId: string; previousState: unknown; newState: unknown }) => Promise<unknown>;
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

/** measurement.config (0203): the payments_ops_config pattern, audited on every write. */
export class DrizzleMeasurementConfig implements MeasurementConfigPort {
  constructor(private readonly audit: Audit) {}

  async values(): Promise<Record<string, string>> {
    const r = rows(await db.execute(sql`select config_key, config_value from measurement.config`));
    return Object.fromEntries(r.map((x) => [String(x.config_key), String(x.config_value)]));
  }

  async set(input: { key: string; value: string; actorId: string }) {
    if (!isMeasurementConfigKey(input.key)) return { ok: false as const, message: `"${input.key}" is not a measurement setting.` };
    const check = validateMeasurementValue(input.key, input.value);
    if (!check.ok) return { ok: false as const, message: check.message };
    const before = await this.values();
    await db.execute(sql`insert into measurement.config (config_key, config_value, updated_by, updated_at) values (${input.key}, ${String(check.value)}, ${input.actorId}::uuid, now())
      on conflict (config_key) do update set config_value = excluded.config_value, updated_by = excluded.updated_by, updated_at = now()`);
    await this.audit({ actorId: input.actorId, action: 'MEASUREMENT_CONFIG_SET', entity: 'measurement_config', entityId: input.key, previousState: { value: before[input.key] ?? null }, newState: { value: String(check.value) } });
    return { ok: true as const };
  }

  async unset(input: { key: string; actorId: string }) {
    if (!isMeasurementConfigKey(input.key)) return { ok: false as const, message: `"${input.key}" is not a measurement setting.` };
    const before = await this.values();
    await db.execute(sql`delete from measurement.config where config_key = ${input.key}`);
    await this.audit({ actorId: input.actorId, action: 'MEASUREMENT_CONFIG_UNSET', entity: 'measurement_config', entityId: input.key, previousState: { value: before[input.key] ?? null }, newState: { value: null } });
    return { ok: true as const, wasSet: before[input.key] !== undefined };
  }
}
