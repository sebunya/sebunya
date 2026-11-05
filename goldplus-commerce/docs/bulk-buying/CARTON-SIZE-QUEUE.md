# Carton sizes: staff queue and data-entry path

Status 2026-11-05: every carton product on /bulk shows "Order by carton. We'll
confirm how many pieces are in a carton with your quote." because
`products.units_per_carton` is empty for all of them. This is missing data,
not a bug. Never fill it from a guess, a fixture or a supplier listing nobody
has checked: staff take each size from a verified packing record (the carton
label or the supplier's packing list, checked against a real carton).

## Where the value lives and how it flows

| Step | Where |
|---|---|
| Stored | `products.bulk_unit` (`carton`/`piece`) and `products.units_per_carton` (NULL = not known; 2 to 10,000), migration 0195 |
| Entered by staff | `/admin/quotes/bulk-terms`: edit one row, or import a CSV of SKU, sold by, pieces per carton, dealer price |
| Read for the page | `DrizzleBulkTermsRepository.findOnSale` -> `POST /quotes/bulk-terms` -> `lib/bulkCatalogue.toBulkRows` -> `data-per-carton` on each `/bulk` row |
| Shown to the buyer | `lib/bulkList.unitLabel` / `countLabel`: "Carton of 12 pieces", "2 cartons (24 pieces)"; unknown says the sentence above |
| Sent | only product id, count and the unit the buyer counted in |
| Checked by the server | `SubmitBulkQuoteUseCase` re-reads unit, size and price by product id; a stale unit is refused (`UNIT_CHANGED`); unknown size is kept as NULL pieces, never 0 |
| Seen by staff | `/admin/quotes/<id>`: "2 cartons (24 pieces)" or "2 cartons, size pending"; the list page flags "carton size pending"; the lines CSV leaves `pieces_per_carton` and `pieces` blank |

Once a size is saved, the next render of /bulk shows it (the page is never
cached). Requests already sent keep the size they were sent with (NULL);
staff confirm those on the call.

## Read-only query: SKUs sold by the carton with no size

Run against production read-only (for example `psql` with a read-only role, or
inside `BEGIN READ ONLY; ... ROLLBACK;`). It changes nothing.

```sql
-- Products on sale, sold by the carton, with no verified pieces-per-carton.
-- requests_waiting = bulk request lines that asked for this product with no size.
SELECT
  p.sku,
  p.model_number,
  p.name,
  c.name AS category,
  pp.dealer_price IS NOT NULL AS has_dealer_price,
  (SELECT count(*)
     FROM quote_request_lines l
    WHERE l.product_id = p.id
      AND l.unit_kind = 'carton'
      AND l.units_per_carton IS NULL) AS requests_waiting
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN product_prices pp ON pp.product_id = p.id
WHERE p.approval_status = 'approved'
  AND p.active = true
  AND p.bulk_unit = 'carton'
  AND p.units_per_carton IS NULL
ORDER BY requests_waiting DESC, c.name, p.sku;
```

Table and column names were checked against `apps/api/src/infrastructure/db/schema`
(products.ts, governance.ts) on 2026-11-05. Not run by the engineer.
