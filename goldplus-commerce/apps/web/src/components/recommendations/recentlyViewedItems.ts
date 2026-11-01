/**
 * Which cards the recently-viewed / browse rail shows (2026-09-24).
 *
 * The PDP saves the product being viewed into the local history on load, and
 * the rail used to read that history as-is: on a first visit the "Browse
 * available products" rail held exactly ONE card — the product already on the
 * screen — and never reached the server-picked fallback because the history
 * was not empty. Now:
 *   1. the page's own product is never recommended to itself;
 *   2. an always-render rail tops a short history up with the server fallback
 *      (never a duplicate, never the excluded product), up to `max` cards.
 * Pure on purpose, so the rule is unit-tested outside the browser.
 */

export interface RailCandidate {
  productId: string;
}

export interface ComposedRailItem<T extends RailCandidate> {
  item: T;
  /** 'history' = the shopper viewed it; 'fallback' = the server's honest shelf pick. */
  source: 'history' | 'fallback';
}

export function composeRecentlyViewedItems<T extends RailCandidate>(
  history: readonly T[],
  fallback: readonly T[],
  options: { excludeProductId?: string; alwaysRender: boolean; max?: number },
): Array<ComposedRailItem<T>> {
  const max = options.max ?? 4;
  const exclude = options.excludeProductId || '';
  const seen = new Set<string>();
  const out: Array<ComposedRailItem<T>> = [];

  for (const item of history) {
    if (out.length >= max) break;
    if (!item?.productId || item.productId === exclude || seen.has(item.productId)) continue;
    seen.add(item.productId);
    out.push({ item, source: 'history' });
  }

  if (options.alwaysRender) {
    for (const item of fallback) {
      if (out.length >= max) break;
      if (!item?.productId || item.productId === exclude || seen.has(item.productId)) continue;
      seen.add(item.productId);
      out.push({ item, source: 'fallback' });
    }
  }

  return out;
}
