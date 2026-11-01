import { sql, type SQL } from 'drizzle-orm';
import { products } from './schema/products';

/**
 * The stock_status a product carries after its on-hand quantity becomes
 * `quantity` — the SQL form of domain/products effectiveStockStatus, for use
 * inside the same UPDATE that writes the quantity.
 *
 * No units: out of stock, unless it is a pre-order (which sells without stock).
 * Units again after being out: in stock. Anything else (low_stock, pre_order)
 * is the operator's own label and is kept. Every stock writer uses this one
 * rule; they had each written 'in_stock'/'out_of_stock' outright, which reset
 * a pre-order to in stock, and the sale path did not update it at all.
 */
export function stockStatusAfter(quantity: SQL | number): SQL {
  return sql`case
    when ${quantity} <= 0 and ${products.stockStatus} <> 'pre_order' then 'out_of_stock'
    when ${quantity} > 0 and ${products.stockStatus} = 'out_of_stock' then 'in_stock'
    else ${products.stockStatus} end`;
}

/**
 * The operator's chosen stock label, applied to the LIVE on-hand quantity in
 * the same statement that writes it (domain effectiveStockStatus, in SQL).
 *
 * A property save derived the label from a quantity read at the start of the
 * request; a sale that took the last unit in between (out_of_stock) was then
 * overwritten back to in_stock at stock 0.
 */
export function stockStatusForLabel(label: string): SQL {
  return sql`case
    when ${products.stockQuantity} <= 0 and ${label}::text <> 'pre_order' then 'out_of_stock'
    when ${products.stockQuantity} > 0 and ${label}::text = 'out_of_stock' then 'in_stock'
    else ${label}::text end`;
}
