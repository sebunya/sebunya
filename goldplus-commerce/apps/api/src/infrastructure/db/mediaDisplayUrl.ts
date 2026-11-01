import { inArray, and, eq } from 'drizzle-orm';
import { sql, type SQL } from 'drizzle-orm';
import { db } from './client';
import { mediaAssetVariants } from './schema/media';

/**
 * The image URL the storefront SHOWS for a product image.
 *
 * `product_images.url` is the original upload and stays the identity the media
 * library dedupes on. What customers, share cards, the merchant feed and the
 * search dropdown receive is the 1024px webp rendition the media library made
 * at upload — smaller, modern, and at a path of its own — falling back to the
 * original for images that have no rendition (legacy /uploads/products files,
 * a gif, an upload made while sharp was unavailable). Every reader goes through
 * here so the choice is made once.
 */
export const DISPLAY_RENDITION = { purpose: 'pdp', format: 'webp' } as const;

/** SQL form, for readers that select the primary image in a subquery. `i` must alias product_images. */
export function displayImageUrlSql(imageAlias: string): SQL<string> {
  const i = sql.raw(imageAlias);
  return sql<string>`COALESCE((SELECT v.url FROM media_asset_variants v WHERE v.asset_id = ${i}.asset_id AND v.purpose = ${DISPLAY_RENDITION.purpose} AND v.format = ${DISPLAY_RENDITION.format} ORDER BY v.width DESC LIMIT 1), ${i}.url)`;
}

/**
 * Focus 4 — THE gallery order for SQL readers (`i` must alias product_images):
 * canonical slot first (cover = slot 1), then the legacy projection for
 * products not yet backfilled. The row-level twin is `resolveGallery` in
 * @goldplus/shared; the two must agree, and `tests/architecture/single-cover-resolver`
 * fails the build if a reader orders images any other way.
 */
export function galleryOrderSql(imageAlias: string): SQL {
  const i = sql.raw(imageAlias);
  return sql`${i}.slot ASC NULLS LAST, ${i}.is_primary DESC, ${i}.display_order ASC`;
}

/**
 * Predicate: rows the gallery shows. A migrated product (any slotted row) shows
 * only its slotted rows; an unmigrated one shows its legacy rows. `i` aliases
 * the row under test and `p` the product (or pass the product id expression).
 */
export function galleryVisibleSql(imageAlias: string, productIdExpr: SQL): SQL {
  const i = sql.raw(imageAlias);
  return sql`(${i}.slot IS NOT NULL OR NOT EXISTS (SELECT 1 FROM product_images s WHERE s.product_id = ${productIdExpr} AND s.slot IS NOT NULL))`;
}

/** Pure choice, unit-testable: the rendition when recorded, else the original. */
export function pickDisplayUrl(original: string, renditionUrl: string | null | undefined): string {
  return renditionUrl && renditionUrl.length > 0 ? renditionUrl : original;
}

/** For readers that load product_images rows: original url → display url, one query per batch. */
export async function displayUrlMap(images: Array<{ url: string; assetId: string | null }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const assetIds = [...new Set(images.map((i) => i.assetId).filter((a): a is string => !!a))];
  const byAsset = new Map<string, string>();
  if (assetIds.length > 0) {
    const rows = await db
      .select({ assetId: mediaAssetVariants.assetId, url: mediaAssetVariants.url, width: mediaAssetVariants.width })
      .from(mediaAssetVariants)
      .where(and(inArray(mediaAssetVariants.assetId, assetIds), eq(mediaAssetVariants.purpose, DISPLAY_RENDITION.purpose), eq(mediaAssetVariants.format, DISPLAY_RENDITION.format)));
    for (const r of rows) if (!byAsset.has(r.assetId)) byAsset.set(r.assetId, r.url);
  }
  for (const i of images) out.set(i.url, pickDisplayUrl(i.url, i.assetId ? byAsset.get(i.assetId) : null));
  return out;
}
