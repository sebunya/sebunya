import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { mediaAssets, mediaAssetVariants, mediaUsages } from '../schema/media';
import { products } from '../schema/products';
import { productImages } from '../schema/phase11';
import { likeContains } from '../like';
import {
  IMediaLibraryRepository,
  MediaAssetRecord,
  MediaUsageRecord,
  MediaVariantRecord,
} from '../../../application/ports/IMediaLibrary';

type AssetRow = typeof mediaAssets.$inferSelect;

export class DrizzleMediaLibraryRepository implements IMediaLibraryRepository {
  private async hydrate(rows: AssetRow[]): Promise<MediaAssetRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const variantRows = await db
      .select()
      .from(mediaAssetVariants)
      .where(sql`${mediaAssetVariants.assetId} in ${ids}`);
    const usageCounts = await db
      .select({ assetId: mediaUsages.assetId, count: sql<number>`count(*)::int` })
      .from(mediaUsages)
      .where(sql`${mediaUsages.assetId} in ${ids}`)
      .groupBy(mediaUsages.assetId);
    const countByAsset = new Map(usageCounts.map((u) => [u.assetId, u.count]));
    const variantsByAsset = new Map<string, MediaVariantRecord[]>();
    for (const v of variantRows) {
      const list = variantsByAsset.get(v.assetId) ?? [];
      list.push({
        purpose: v.purpose as MediaVariantRecord['purpose'],
        format: v.format as MediaVariantRecord['format'],
        width: v.width,
        height: v.height,
        byteSize: v.byteSize,
        storageKey: v.storageKey,
        url: v.url,
      });
      variantsByAsset.set(v.assetId, list);
    }
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      mime: r.mime,
      byteSize: r.byteSize,
      width: r.width,
      height: r.height,
      checksum: r.checksum,
      storageKey: r.storageKey,
      url: r.url,
      altText: r.altText,
      caption: r.caption,
      rights: r.rights,
      rightsExpiresAt: r.rightsExpiresAt,
      focalX: r.focalX,
      focalY: r.focalY,
      status: r.status as 'ACTIVE' | 'ARCHIVED',
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      usageCount: countByAsset.get(r.id) ?? 0,
      variants: variantsByAsset.get(r.id) ?? [],
    }));
  }

  async findByChecksum(checksum: string): Promise<MediaAssetRecord | null> {
    const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.checksum, checksum)).limit(1);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async findById(id: string): Promise<MediaAssetRecord | null> {
    const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async create(asset: Parameters<IMediaLibraryRepository['create']>[0]): Promise<MediaAssetRecord> {
    const [row] = await db
      .insert(mediaAssets)
      .values({
        filename: asset.filename,
        mime: asset.mime,
        byteSize: asset.byteSize,
        width: asset.width,
        height: asset.height,
        checksum: asset.checksum,
        storageKey: asset.storageKey,
        url: asset.url,
        altText: asset.altText,
        caption: asset.caption,
        createdBy: asset.createdBy,
      })
      .returning();
    return (await this.hydrate([row]))[0];
  }

  async addVariants(assetId: string, variants: MediaVariantRecord[]): Promise<void> {
    if (variants.length === 0) return;
    await db
      .insert(mediaAssetVariants)
      .values(variants.map((v) => ({ assetId, ...v })))
      .onConflictDoNothing();
  }

  async list(args: { query?: string; status?: 'ACTIVE' | 'ARCHIVED'; mime?: string; page: number; limit: number }) {
    const conditions = [];
    if (args.status) conditions.push(eq(mediaAssets.status, args.status));
    if (args.mime) conditions.push(eq(mediaAssets.mime, args.mime));
    if (args.query) {
      conditions.push(
        or(
          ilike(mediaAssets.filename, likeContains(args.query)),
          ilike(mediaAssets.altText, likeContains(args.query)),
          ilike(mediaAssets.caption, likeContains(args.query)),
        )!,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (args.page - 1) * args.limit;
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(where)
      .orderBy(desc(mediaAssets.createdAt))
      .limit(args.limit)
      .offset(offset);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(mediaAssets)
      .where(where);
    return { items: await this.hydrate(rows), total };
  }

  async updateMetadata(id: string, patch: Parameters<IMediaLibraryRepository['updateMetadata']>[1]) {
    const [row] = await db
      .update(mediaAssets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(mediaAssets.id, id))
      .returning();
    return row ? (await this.hydrate([row]))[0] : null;
  }

  async setStatus(id: string, status: 'ACTIVE' | 'ARCHIVED') {
    const [row] = await db
      .update(mediaAssets)
      .set({ status, updatedAt: new Date() })
      .where(eq(mediaAssets.id, id))
      .returning();
    return row ? (await this.hydrate([row]))[0] : null;
  }

  async usages(assetId: string): Promise<MediaUsageRecord[]> {
    const rows = await db.select().from(mediaUsages).where(eq(mediaUsages.assetId, assetId));
    return rows.map((r) => ({ entity: r.entity, entityId: r.entityId, field: r.field, createdAt: r.createdAt }));
  }

  async recordUsage(assetId: string, entity: string, entityId: string, field: string): Promise<void> {
    await db.insert(mediaUsages).values({ assetId, entity, entityId, field }).onConflictDoNothing();
  }

  async removeUsage(assetId: string, entity: string, entityId: string, field: string): Promise<void> {
    await db
      .delete(mediaUsages)
      .where(
        and(
          eq(mediaUsages.assetId, assetId),
          eq(mediaUsages.entity, entity),
          eq(mediaUsages.entityId, entityId),
          eq(mediaUsages.field, field),
        ),
      );
  }

  async deleteRow(id: string): Promise<void> {
    await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
  }

  async productsMissingImages(): Promise<Array<{ id: string; name: string; slug: string }>> {
    return db
      .select({ id: products.id, name: products.name, slug: products.slug })
      .from(products)
      .where(or(eq(products.hasImage, false), isNull(products.imageUrl), eq(products.imageUrl, '')))
      .orderBy(products.name)
      .limit(200);
  }

  async assignPrimaryProductImage(productId: string, asset: MediaAssetRecord) {
    // All three writes or none. Autocommitted, a failure after the demote
    // left the product pointing at an image its gallery marked as not
    // primary, so the PDP and the gallery disagreed about the main photo.
    return db.transaction(async (tx) => {
      const [product] = await tx
        .update(products)
        .set({ imageUrl: asset.url, hasImage: true })
        .where(eq(products.id, productId))
        .returning({ id: products.id });
      if (!product) return null;
      // Gallery consistency: demote existing primaries, then add the library-backed row.
      await tx.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, productId));
      await tx.insert(productImages).values({
        productId,
        url: asset.url,
        altText: asset.altText,
        isPrimary: true,
        assetId: asset.id,
      });
      return { productId, url: asset.url };
    });
  }
}
