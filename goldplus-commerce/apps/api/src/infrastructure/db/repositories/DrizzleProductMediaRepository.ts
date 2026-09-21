import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { GallerySlot } from '@goldplus/shared';
import { db } from '../client';
import { products } from '../schema/products';
import { productImages } from '../schema/phase11';
import { mediaAssets, mediaAssetVariants, mediaUsages } from '../schema/media';
import { auditLogs } from '../schema/system';
import { auditEntityId } from '../../../domain/audit/AuditEntityId';
import type { SlotAssignment, SlotMap } from '../../../domain/media/ProductMediaSlotMap';
import type { ApplySlotMapResult, IProductMediaRepository, ProductMediaRow, ProductMediaSnapshot, ReadyAsset, SlotMapAudit } from '../../../application/ports/IProductMediaRepository';
import { DISPLAY_RENDITION } from '../mediaDisplayUrl';

export const GALLERY_AUDIT_ENTITY = 'product_media';
export const GALLERY_AUDIT_ACTION = 'PRODUCT_MEDIA_SLOTS_CHANGED';
const GALLERY_USAGE_FIELD = 'gallery';
const LEGACY_PRIMARY_USAGE_FIELD = 'primary_image';

function readyExpression() {
  return sql<boolean>`EXISTS (SELECT 1 FROM ${mediaAssetVariants} v WHERE v.asset_id = ${mediaAssets.id} AND v.purpose = ${DISPLAY_RENDITION.purpose} AND v.format = ${DISPLAY_RENDITION.format}) AND ${mediaAssets.status} = 'ACTIVE'`;
}

export class DrizzleProductMediaRepository implements IProductMediaRepository {
  async getSnapshot(productId: string): Promise<ProductMediaSnapshot | null> {
    const product = await db.query.products.findFirst({ where: eq(products.id, productId), columns: { id: true, sku: true, name: true, slug: true, mediaRevision: true } });
    if (!product) return null;
    const rows = await db
      .select({
        imageId: productImages.id,
        assetId: productImages.assetId,
        slot: productImages.slot,
        isPrimary: productImages.isPrimary,
        displayOrder: productImages.displayOrder,
        url: productImages.url,
        altText: productImages.altText,
        assetFilename: mediaAssets.filename,
        assetWidth: mediaAssets.width,
        assetHeight: mediaAssets.height,
        assetBytes: mediaAssets.byteSize,
        assetStatus: mediaAssets.status,
        assetReady: sql<boolean>`COALESCE(${readyExpression()}, false)`,
        displayUrl: sql<string | null>`(SELECT v.url FROM ${mediaAssetVariants} v WHERE v.asset_id = ${productImages.assetId} AND v.purpose = ${DISPLAY_RENDITION.purpose} AND v.format = ${DISPLAY_RENDITION.format} ORDER BY v.width DESC LIMIT 1)`,
        thumbUrl: sql<string | null>`(SELECT v.url FROM ${mediaAssetVariants} v WHERE v.asset_id = ${productImages.assetId} AND v.purpose = 'thumb' AND v.format = 'webp' LIMIT 1)`,
      })
      .from(productImages)
      .leftJoin(mediaAssets, eq(mediaAssets.id, productImages.assetId))
      .where(eq(productImages.productId, productId))
      .orderBy(sql`${productImages.slot} NULLS LAST`, desc(productImages.isPrimary), productImages.displayOrder, productImages.createdAt);
    const mapped: ProductMediaRow[] = rows.map((r) => ({
      imageId: r.imageId,
      assetId: r.assetId,
      slot: (r.slot ?? null) as GallerySlot | null,
      isPrimary: r.isPrimary,
      displayOrder: r.displayOrder,
      url: r.url,
      altText: r.altText,
      asset: r.assetId && r.assetFilename
        ? { filename: r.assetFilename, width: r.assetWidth, height: r.assetHeight, byteSize: Number(r.assetBytes ?? 0), status: r.assetStatus ?? 'ACTIVE', displayUrl: r.displayUrl, thumbUrl: r.thumbUrl, ready: Boolean(r.assetReady) }
        : null,
    }));
    return { productId: product.id, sku: product.sku, name: product.name, slug: product.slug, mediaRevision: product.mediaRevision, rows: mapped };
  }

  async findReadyAssets(assetIds: readonly string[]): Promise<ReadyAsset[]> {
    const ids = Array.from(new Set(assetIds)).filter(Boolean);
    if (ids.length === 0) return [];
    const rows = await db
      .select({ id: mediaAssets.id, url: mediaAssets.url, altText: mediaAssets.altText })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, ids), readyExpression()));
    return rows.map((r) => ({ id: r.id, url: r.url, altText: r.altText ?? null }));
  }

  async applySlotMap(productId: string, expectedRevision: number, map: SlotMap, audit: SlotMapAudit): Promise<ApplySlotMapResult> {
    return db.transaction(async (tx) => {
      // 1. Lock the parent row; every concurrent gallery write on this product queues here.
      const [locked] = await tx.select({ id: products.id, mediaRevision: products.mediaRevision }).from(products).where(eq(products.id, productId)).for('update');
      if (!locked) return { kind: 'NOT_FOUND' as const };
      if (locked.mediaRevision !== expectedRevision) return { kind: 'STALE' as const, currentRevision: locked.mediaRevision };

      // 2. The assets must still be ready at write time (a plan approved earlier could be stale).
      const assetIds = map.map((a) => a.assetId);
      const readyRows = assetIds.length
        ? await tx.select({ id: mediaAssets.id, url: mediaAssets.url }).from(mediaAssets).where(and(inArray(mediaAssets.id, assetIds), readyExpression()))
        : [];
      const readyById = new Map(readyRows.map((r) => [r.id, r]));
      for (const a of map) if (!readyById.has(a.assetId)) throw new Error(`ASSET_NOT_READY:${a.assetId}`);

      // 3. Park every gallery row at NULL (the partial unique indexes ignore NULL), so a swap
      //    never collides and no illegal slot is ever written.
      const existing = await tx.select({ id: productImages.id, assetId: productImages.assetId, slot: productImages.slot }).from(productImages).where(eq(productImages.productId, productId));
      const previouslySlotted = existing.filter((r) => r.slot !== null);
      if (previouslySlotted.length) {
        await tx.update(productImages).set({ slot: null, isPrimary: false, updatedAt: new Date() }).where(and(eq(productImages.productId, productId), isNotNull(productImages.slot)));
      }

      // 4. Rows that were in the gallery but are not in the new map leave the gallery. The asset
      //    itself stays in the library (reference-aware retention); only the assignment row goes.
      const keepAssets = new Set(assetIds);
      const leaving = previouslySlotted.filter((r) => !r.assetId || !keepAssets.has(r.assetId));
      if (leaving.length) await tx.delete(productImages).where(inArray(productImages.id, leaving.map((r) => r.id)));

      // 5. Write the new map: update the row that already carries the asset, else insert one.
      const byAsset = new Map(existing.filter((r) => r.assetId).map((r) => [r.assetId as string, r]));
      const written: SlotAssignment[] = [];
      for (const a of map) {
        const asset = readyById.get(a.assetId)!;
        const projection = { slot: a.slot, isPrimary: a.slot === 1, displayOrder: a.slot - 1, altText: a.altText, updatedAt: new Date() };
        const row = byAsset.get(a.assetId);
        if (row) {
          await tx.update(productImages).set(projection).where(eq(productImages.id, row.id));
        } else {
          await tx.insert(productImages).values({ productId, url: asset.url, assetId: a.assetId, ...projection });
        }
        written.push({ slot: a.slot, assetId: a.assetId, altText: a.altText });
      }

      // 6. Legacy projection on the product row: the cover, or nothing.
      const cover = map.find((a) => a.slot === 1);
      const nextRevision = locked.mediaRevision + 1;
      await tx
        .update(products)
        .set({ imageUrl: cover ? readyById.get(cover.assetId)!.url : null, hasImage: Boolean(cover), mediaRevision: nextRevision, updatedAt: new Date() })
        .where(eq(products.id, productId));

      // 7. Usage graph: one row per assigned asset; drop the product's old gallery/primary usages
      //    for assets that are no longer assigned, so safeDelete stays truthful in both directions.
      await tx
        .delete(mediaUsages)
        .where(and(eq(mediaUsages.entity, 'product'), eq(mediaUsages.entityId, productId), inArray(mediaUsages.field, [GALLERY_USAGE_FIELD, LEGACY_PRIMARY_USAGE_FIELD]), assetIds.length ? sql`${mediaUsages.assetId} NOT IN (${sql.join(assetIds.map((id) => sql`${id}`), sql`, `)})` : sql`true`));
      for (const a of map) {
        await tx
          .insert(mediaUsages)
          .values({ assetId: a.assetId, entity: 'product', entityId: productId, field: GALLERY_USAGE_FIELD })
          .onConflictDoNothing();
      }

      // 8. Audit in the same transaction: actor, action, old/new maps, revision, request id.
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actorId: audit.actorId,
        action: GALLERY_AUDIT_ACTION,
        entity: GALLERY_AUDIT_ENTITY,
        entityId: auditEntityId(GALLERY_AUDIT_ENTITY, productId),
        previousState: { map: audit.previousMap, revision: locked.mediaRevision },
        newState: { map: written, revision: nextRevision, action: audit.action, requestId: audit.requestId ?? null },
      });

      return { kind: 'APPLIED' as const, mediaRevision: nextRevision, map: written };
    });
  }

  async listGalleryAudit(productId: string, limit: number) {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entity, GALLERY_AUDIT_ENTITY), eq(auditLogs.entityId, auditEntityId(GALLERY_AUDIT_ENTITY, productId))))
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.max(1, Math.min(limit, 200)));
    return rows.map((r) => {
      const prev = (r.previousState as { map?: SlotMap } | null)?.map ?? [];
      const next = (r.newState as { map?: SlotMap; revision?: number; action?: string } | null) ?? {};
      return { id: r.id, action: next.action ?? r.action, actorId: r.actorId, createdAt: r.createdAt, previousMap: prev, newMap: next.map ?? [], revision: next.revision ?? 0 };
    });
  }

  /** Products whose gallery has no slotted rows yet (backfill candidates), with their legacy rows. */
  async listUnmigratedProducts(limit: number, afterId: string | null): Promise<Array<{ productId: string; sku: string; mediaRevision: number }>> {
    const rows = await db
      .select({ productId: products.id, sku: products.sku, mediaRevision: products.mediaRevision })
      .from(products)
      .where(and(
        afterId ? sql`${products.id} > ${afterId}` : sql`true`,
        sql`NOT EXISTS (SELECT 1 FROM ${productImages} pi WHERE pi.product_id = ${products.id} AND pi.slot IS NOT NULL)`,
        sql`EXISTS (SELECT 1 FROM ${productImages} pi WHERE pi.product_id = ${products.id})`,
      ))
      .orderBy(products.id)
      .limit(limit);
    return rows;
  }

  /** Completeness across the catalogue for the queue. */
  async listCompleteness(): Promise<Array<{ productId: string; sku: string; name: string; slug: string; active: boolean; approvalStatus: string; assigned: number; hasCover: boolean; migrated: boolean; legacyRows: number; unreadyRows: number; mediaRevision: number }>> {
    const rows = await db.execute(sql`
      SELECT p.id AS product_id, p.sku, p.name, p.slug, p.active, p.approval_status, p.media_revision,
        COUNT(pi.id) FILTER (WHERE pi.slot IS NOT NULL) AS assigned,
        BOOL_OR(pi.slot = 1) AS has_cover,
        COUNT(pi.id) FILTER (WHERE pi.slot IS NOT NULL) > 0 AS migrated,
        COUNT(pi.id) FILTER (WHERE pi.slot IS NULL) AS legacy_rows,
        COUNT(pi.id) FILTER (WHERE pi.slot IS NOT NULL AND NOT COALESCE((SELECT a.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM media_asset_variants v WHERE v.asset_id = a.id AND v.purpose = ${DISPLAY_RENDITION.purpose} AND v.format = ${DISPLAY_RENDITION.format}) FROM media_assets a WHERE a.id = pi.asset_id), false)) AS unready_rows
      FROM products p
      LEFT JOIN product_images pi ON pi.product_id = p.id
      GROUP BY p.id
      ORDER BY p.sku`);
    return (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows?.map(mapCompletenessRow) ?? (rows as unknown as Array<Record<string, unknown>>).map(mapCompletenessRow);
  }
}

function mapCompletenessRow(r: Record<string, unknown>) {
  return {
    productId: String(r.product_id),
    sku: String(r.sku),
    name: String(r.name),
    slug: String(r.slug),
    active: Boolean(r.active),
    approvalStatus: String(r.approval_status),
    mediaRevision: Number(r.media_revision ?? 0),
    assigned: Number(r.assigned ?? 0),
    hasCover: Boolean(r.has_cover),
    migrated: Boolean(r.migrated),
    legacyRows: Number(r.legacy_rows ?? 0),
    unreadyRows: Number(r.unready_rows ?? 0),
  };
}
