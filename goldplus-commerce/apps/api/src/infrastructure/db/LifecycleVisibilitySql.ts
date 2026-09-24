import { sql, type SQL } from 'drizzle-orm';

/**
 * "The operator has not retired this product's page", as SQL — for every
 * machine surface that lists product URLs (sitemap, Merchant Center feed).
 *
 * A lifecycle decision only writes seo_product_lifecycle; it never touches
 * products.active or approval_status. Only the HTML product page used to read
 * it, so a product marked GONE_410, UNPUBLISH or REDIRECT_301_* stayed in the
 * sitemap (Google: "Submitted URL returns 4xx") and in the feed (an ad whose
 * landing page is gone). This mirrors lifecycleSeoOutcome exactly:
 *   - REDIRECT_301_* (a successor is required by constraint) → 301, not listed;
 *   - GONE_410 → 410, not listed;
 *   - UNPUBLISH → noindex, not listed;
 *   - otherwise, a DRAFT or UNPUBLISHED state is noindex unless the operator
 *     chose OFFER_ALTERNATIVE (an honest, indexable discontinued page).
 * A product with no lifecycle row is unaffected.
 */
export function notRetiredByLifecycle(productId: SQL): SQL {
  return sql`not exists (
    select 1 from seo_product_lifecycle l
    where l.product_id = ${productId}
      and (
        l.disposition in ('GONE_410', 'UNPUBLISH')
        or l.disposition in ('REDIRECT_301_SUCCESSOR', 'REDIRECT_301_REPLACEMENT')
        or (l.disposition <> 'OFFER_ALTERNATIVE' and l.state in ('DRAFT', 'UNPUBLISHED'))
      )
  )`;
}
