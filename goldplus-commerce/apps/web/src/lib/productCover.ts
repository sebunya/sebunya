/**
 * Does this product have a REAL photograph as its cover?
 *
 * Products without photography carry a generated sample frame whose alt text
 * begins "Sample " ("Sample image (no photo of this product yet) — …"). Showing
 * that frame on the product page is the owner's policy, and it stays. But the
 * shop window — the home page's featured slots and the header's feature cards —
 * must be filled from real photography first, or the first screens after the
 * hero are a wall of "SAMPLE IMAGE · REAL PHOTO COMING" tiles while the real
 * shots go unused.
 *
 * ONE rule, the same one ProductJsonLd, the product page's share image and the
 * merchant feed already apply: an image whose alt starts with "Sample " is a
 * placeholder, never a photo.
 */

export const SAMPLE_ALT_PREFIX = 'Sample ';

interface CoverLike {
  primaryImageUrl?: string | null;
  images?: ReadonlyArray<{ url?: string | null; alt?: string | null }> | null;
}

export function isSampleAlt(alt: string | null | undefined): boolean {
  return (alt ?? '').startsWith(SAMPLE_ALT_PREFIX);
}

export function hasRealCover(product: CoverLike | null | undefined): boolean {
  if (!product?.primaryImageUrl) return false;
  const images = product.images ?? [];
  // The cover is the image the card actually shows: the one at primaryImageUrl,
  // or the first image when the URL is a rendition of it rather than a match.
  const cover = images.find((image) => image?.url === product.primaryImageUrl) ?? images[0];
  return !isSampleAlt(cover?.alt);
}

/**
 * Stable partition: every product with a real cover first, in its original
 * order, then everything else in its original order. Nothing is dropped, so a
 * catalogue with few photos still fills every slot.
 */
export function realCoversFirst<T extends CoverLike>(products: readonly T[]): T[] {
  const real: T[] = [];
  const rest: T[] = [];
  for (const product of products) (hasRealCover(product) ? real : rest).push(product);
  return [...real, ...rest];
}

/** The same partition over any list keyed by product id (e.g. recommendation items). */
export function preferIds<T>(items: readonly T[], ids: ReadonlySet<string>, idOf: (item: T) => string | undefined): T[] {
  if (ids.size === 0) return [...items];
  const first: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const id = idOf(item);
    (id && ids.has(id) ? first : rest).push(item);
  }
  return [...first, ...rest];
}
