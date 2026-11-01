import { PERMISSIONS } from '@goldplus/shared';

/**
 * Whether an admin may edit a product's prices (Price D and the A/B/C tiers)
 * on the product editor. The SAME rule the API enforces on
 * PUT /admin/products/:id (PRICING_PERMISSION_REQUIRED): pricing.manage or
 * pricing.approve. Without one, the editor shows the prices read-only and
 * resubmits them unchanged, so the rest of the form still saves.
 */
export function canEditProductPrices(permissions: readonly string[] | null | undefined): boolean {
  const perms = permissions ?? [];
  return perms.includes(PERMISSIONS.PRICING_MANAGE) || perms.includes(PERMISSIONS.PRICING_APPROVE);
}
