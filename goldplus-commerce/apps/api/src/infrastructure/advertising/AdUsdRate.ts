import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { validRate } from '../../domain/advertising/AdMoney';

const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
let cache: { at: number; rate: number | null } | null = null;

/** The owner's shillings-per-dollar rate (ad_settings, 0172); null = not set, or 0172 not applied. Cached 60 s. */
export async function adUsdRate(): Promise<number | null> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rate;
  let rate: number | null = null;
  try {
    const r = rowsOf(await db.execute(sql`select ugx_per_usd from ad_settings where id = true`))[0]?.ugx_per_usd;
    rate = validRate(Number(r)) ? Number(r) : null;
  } catch { rate = null; }
  cache = { at: Date.now(), rate };
  return rate;
}

export async function setAdUsdRate(rate: number | null, actorId: string | null): Promise<void> {
  await db.execute(sql`insert into ad_settings (id, ugx_per_usd, updated_by, updated_at) values (true, ${rate}, ${actorId}::uuid, now())
    on conflict (id) do update set ugx_per_usd = excluded.ugx_per_usd, updated_by = excluded.updated_by, updated_at = now()`);
  cache = null;
}
