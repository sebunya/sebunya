/**
 * The four steps from product page to paid order, for one window, plus the money that stopped at each step.
 * Counts of different things (shoppers, carts, orders), not one linked cohort: see GetSalesFunnelUseCase.
 */
export interface SalesFunnelCounts {
  /** Distinct shoppers (profile, else account, else anonymous id) who opened a product page. */
  productViewers: number;
  /** Carts that held at least one item and were touched in the window (checkout keeps the items). */
  cartsWithItems: number;
  /** Orders placed in the window: the same definition as Commerce Analytics' order count. */
  ordersPlaced: number;
  ordersPlacedValueUgx: number;
  ordersPaid: number;
  ordersPaidValueUgx: number;
  /** Placed in the window, not paid, not cancelled: money a customer agreed to and has not paid. */
  unpaidOpenValueUgx: number;
  /** Carts classified abandoned in the window (6 h idle), and what was in them. */
  abandonedCarts: number;
  abandonedCartValueUgx: number;
}

export interface ISalesFunnelReader {
  counts(start: Date, end: Date): Promise<SalesFunnelCounts>;
}
