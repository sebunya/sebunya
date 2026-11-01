/**
 * The price a structured-data Offer must carry: the price the customer is
 * shown and will pay — the campaign sale price while a campaign runs, the
 * regular price otherwise.
 *
 * Until 2026-09-12 every Product JSON-LD (the PDP and the /shop ItemList) put
 * `retailPriceUgx` in `offers.price` while the page rendered the sale price
 * and the merchant feed advertised it: 15,000 in the markup, 13,500 on the
 * page and in the feed. That is the "price mismatch" Merchant Center
 * disapproves and the inconsistency rich results are built to punish.
 *
 * Only a real reduction counts: a sale price that is missing, non-numeric,
 * non-positive, or not below the regular price leaves the regular price.
 */
export function offerPriceUgx(retailUgx: number, saleUgx: number | null | undefined): number {
  if (typeof saleUgx === 'number' && Number.isFinite(saleUgx) && saleUgx > 0 && saleUgx < retailUgx) {
    return Math.round(saleUgx);
  }
  return retailUgx;
}
