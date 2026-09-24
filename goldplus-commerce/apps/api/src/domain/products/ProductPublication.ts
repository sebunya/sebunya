import type { StockStatus } from './ProductEntity';

/**
 * Who may put a product on the storefront, and when. Pure — no framework.
 *
 * Approving IS publishing: an approved, active product is live. The bulk path
 * required PRODUCTS_PUBLISH and refused products with no stock, while the
 * single create/edit form let anyone with PRODUCTS_WRITE tick "Approved" and
 * "Active". One rule now serves both.
 */
export interface PublicationState {
  approvalStatus: 'draft' | 'approved' | 'rejected';
  active: boolean;
}

export const isPublished = (s: PublicationState): boolean => s.approvalStatus === 'approved' && s.active;

export type PublicationDecision =
  | { ok: true }
  | { ok: false; status: 400 | 403; code: 'PUBLISH_PERMISSION_REQUIRED' | 'NO_STOCK' | 'NO_PRICE'; message: string };

export function checkPublicationChange(input: {
  before: PublicationState | null;
  after: PublicationState;
  canPublish: boolean;
  stockQuantity: number;
  stockStatus: StockStatus;
  /** As on the bulk path: stock is required to go live unless the caller says otherwise. */
  requireStock?: boolean;
  /**
   * The selling price (Price D) the product will carry. When given, a live
   * product must have one: priced at 0 it rendered "Price on request" with an
   * Add-to-cart that dead-ended at checkout (PRICE_UNAVAILABLE).
   */
  priceUgx?: number;
}): PublicationDecision {
  const approving = input.after.approvalStatus === 'approved' && input.before?.approvalStatus !== 'approved';
  const goingLive = isPublished(input.after) && !(input.before && isPublished(input.before));
  // Checked for a product that IS or STAYS live too: clearing the price of a
  // live product is the same dead end as publishing one without a price.
  if (isPublished(input.after) && input.priceUgx !== undefined && !(Number(input.priceUgx) > 0)) {
    return { ok: false, status: 400, code: 'NO_PRICE', message: 'Set a selling price before publishing.' };
  }
  if (!approving && !goingLive) return { ok: true };
  if (!input.canPublish) {
    return {
      ok: false,
      status: 403,
      code: 'PUBLISH_PERMISSION_REQUIRED',
      message: 'Approving or publishing a product needs the publish permission. Save it as a draft and ask someone who can publish.',
    };
  }
  if (goingLive && input.requireStock !== false && input.stockQuantity <= 0 && input.stockStatus !== 'pre_order') {
    return {
      ok: false,
      status: 400,
      code: 'NO_STOCK',
      message: 'A product with no stock cannot go live. Record its stock first, or mark it as a pre-order.',
    };
  }
  return { ok: true };
}

/**
 * The stock status a product should carry for a given on-hand quantity. The
 * form's dropdown used to be written as-is after the quantity, so a product
 * saved with 0 units stayed "in stock" in the filter and the Merchant feed.
 * Pre-order and low-stock are the operator's own labels and are kept.
 */
export function effectiveStockStatus(status: StockStatus, quantity: number): StockStatus {
  if (quantity <= 0 && status !== 'pre_order') return 'out_of_stock';
  if (quantity > 0 && status === 'out_of_stock') return 'in_stock';
  return status;
}
