/**
 * Which products an ops script may touch, kept free of database imports so it can be tested.
 *
 * Photo batches arrive for DRAFT products (they are drafted because they have no photo).
 * The placeholder clean-up used to look only at products on sale, so naming a draft in
 * ONLY silently did nothing and its "Sample" pictures stayed in front of the real photos
 * (2026-10-13, batch 4). Removing is now allowed for drafts named in ONLY; adding
 * placeholders stays limited to products on sale.
 */
export const MAX_ONLY_SKUS = 20;

/** "GP-A, GP-B" → a set of trimmed, upper-cased SKUs; blanks and duplicates dropped. */
export function parseOnly(raw: string | undefined | null): Set<string> {
  return new Set(String(raw ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
}

export function frameTargets<T extends { sku: string; active: boolean }>(all: T[], only: Set<string>, mode: 'fill' | 'remove'): T[] {
  return all.filter((p) => {
    const named = only.has(p.sku.toUpperCase());
    if (only.size > 0 && !named) return false;
    return p.active || (mode === 'remove' && named);
  });
}
