import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { mediaAssets, mediaAssetVariants, mediaUsages } from '../db/schema/media';
import type { IAmbassadorMedia, ResolvedPortrait } from '../../application/ports/IAmbassadorMedia';

const ENTITY = 'homepage_ambassador';
const FIELD = 'portrait';

export class DrizzleAmbassadorMedia implements IAmbassadorMedia {
  async resolveByUrl(url: string): Promise<ResolvedPortrait | null> {
    // The editor may hold the original's address or a rendition's (e.g. a pasted card.webp).
    const [asset] = await db
      .select({ id: mediaAssets.id, url: mediaAssets.url, width: mediaAssets.width, height: mediaAssets.height, status: mediaAssets.status })
      .from(mediaAssets)
      .where(or(eq(mediaAssets.url, url), sql`${mediaAssets.id} IN (SELECT asset_id FROM media_asset_variants WHERE url = ${url})`))
      .limit(1);
    if (!asset) return null;
    const variants = await db
      .select({ purpose: mediaAssetVariants.purpose, format: mediaAssetVariants.format, width: mediaAssetVariants.width, height: mediaAssetVariants.height, url: mediaAssetVariants.url })
      .from(mediaAssetVariants)
      .where(eq(mediaAssetVariants.assetId, asset.id));
    return {
      assetId: asset.id,
      original: { url: asset.url, width: asset.width ?? null, height: asset.height ?? null },
      variants: variants.map((v) => ({ purpose: String(v.purpose), format: String(v.format), width: v.width ?? null, height: v.height ?? null, url: v.url })),
      status: asset.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    };
  }

  async syncUsages(current: Array<{ personId: string; assetId: string }>): Promise<void> {
    await db.transaction(async (tx) => {
      const keep = current.map((c) => `${c.personId}:${c.assetId}`);
      const existing = await tx.select({ id: mediaUsages.id, entityId: mediaUsages.entityId, assetId: mediaUsages.assetId }).from(mediaUsages)
        .where(and(eq(mediaUsages.entity, ENTITY), eq(mediaUsages.field, FIELD)));
      const stale = existing.filter((e) => !keep.includes(`${e.entityId}:${e.assetId}`)).map((e) => e.id);
      if (stale.length > 0) await tx.delete(mediaUsages).where(inArray(mediaUsages.id, stale));
      if (current.length > 0) {
        await tx.insert(mediaUsages).values(current.map((c) => ({ assetId: c.assetId, entity: ENTITY, entityId: c.personId, field: FIELD }))).onConflictDoNothing();
      }
    });
  }
}
