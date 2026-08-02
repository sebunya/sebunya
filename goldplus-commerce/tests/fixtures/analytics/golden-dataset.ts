/**
 * Commerce Analytics golden dataset.
 *
 * Every expected value below is HAND-CALCULATED from the order list and
 * written as a literal — never derived by running the implementation under
 * test. If an expectation here disagrees with the code, the code is wrong.
 *
 * Period under test: 2026-07-01 .. 2026-07-31 in Africa/Kampala (UTC+3), i.e.
 *   UTC instants 2026-06-30T21:00:00.000Z .. 2026-07-31T20:59:59.999Z.
 * Comparison window: 2026-05-31 .. 2026-06-30 Kampala days.
 *
 * Kampala midnight boundary rows:
 *  - G6 at 2026-06-30T21:30Z is 00:30 on 1 July in Kampala → INSIDE current.
 *  - G7 at 2026-07-31T20:30Z is 23:30 on 31 July in Kampala → INSIDE current.
 *  - GX at 2026-06-30T20:30Z is 23:30 on 30 June in Kampala → previous window.
 */

export interface GoldenOrder {
  id: string;
  createdAtUtc: string;
  paymentStatus: string;
  orderStatus: string;
  totalAmount: number;
  pricingDiscountTotal: number;
  deliveryFee: number;
}

export const GOLDEN_PERIOD = { startDate: '2026-07-01', endDate: '2026-07-31' } as const;

export const GOLDEN_ORDERS: GoldenOrder[] = [
  { id: 'G1', createdAtUtc: '2026-07-05T08:00:00.000Z', paymentStatus: 'paid', orderStatus: 'completed', totalAmount: 150_000, pricingDiscountTotal: 10_000, deliveryFee: 5_000 },
  { id: 'G2', createdAtUtc: '2026-07-05T09:00:00.000Z', paymentStatus: 'paid', orderStatus: 'completed', totalAmount: 250_000, pricingDiscountTotal: 0, deliveryFee: 10_000 },
  { id: 'G3', createdAtUtc: '2026-07-10T12:00:00.000Z', paymentStatus: 'failed', orderStatus: 'received', totalAmount: 90_000, pricingDiscountTotal: 0, deliveryFee: 0 },
  { id: 'G4', createdAtUtc: '2026-07-15T14:30:00.000Z', paymentStatus: 'pending', orderStatus: 'received', totalAmount: 120_000, pricingDiscountTotal: 5_000, deliveryFee: 5_000 },
  { id: 'G5', createdAtUtc: '2026-07-20T10:00:00.000Z', paymentStatus: 'rejected', orderStatus: 'cancelled', totalAmount: 60_000, pricingDiscountTotal: 0, deliveryFee: 0 },
  { id: 'G6', createdAtUtc: '2026-06-30T21:30:00.000Z', paymentStatus: 'paid', orderStatus: 'received', totalAmount: 100_000, pricingDiscountTotal: 0, deliveryFee: 0 },
  { id: 'G7', createdAtUtc: '2026-07-31T20:30:00.000Z', paymentStatus: 'paid', orderStatus: 'received', totalAmount: 50_000, pricingDiscountTotal: 2_000, deliveryFee: 3_000 },
  // Previous comparison window (2026-05-31 .. 2026-06-30 Kampala):
  { id: 'GX', createdAtUtc: '2026-06-30T20:30:00.000Z', paymentStatus: 'paid', orderStatus: 'completed', totalAmount: 80_000, pricingDiscountTotal: 0, deliveryFee: 0 },
  { id: 'G9', createdAtUtc: '2026-06-15T10:00:00.000Z', paymentStatus: 'paid', orderStatus: 'completed', totalAmount: 200_000, pricingDiscountTotal: 0, deliveryFee: 0 },
  { id: 'G10', createdAtUtc: '2026-06-20T10:00:00.000Z', paymentStatus: 'failed', orderStatus: 'received', totalAmount: 40_000, pricingDiscountTotal: 0, deliveryFee: 0 },
  // Far outside both windows; must influence nothing:
  { id: 'GOLD', createdAtUtc: '2026-01-15T10:00:00.000Z', paymentStatus: 'paid', orderStatus: 'completed', totalAmount: 999_999, pricingDiscountTotal: 0, deliveryFee: 0 },
];

/**
 * Hand calculation, current period (G1..G7):
 *   orders                = 7
 *   paid orders           = 4  (G1 G2 G6 G7)
 *   paid order value      = 150000+250000+100000+50000               = 550000
 *   gross order value     = 150000+250000+90000+120000+60000+100000+50000 = 820000
 *   discount value        = 10000+0+0+5000+0+0+2000                  = 17000
 *   delivery fee value    = 5000+10000+0+5000+0+0+3000               = 23000
 *   failed payments       = 2  (G3 failed, G5 rejected)
 *   completed orders      = 2  (G1 G2)
 *   cancelled orders      = 1  (G5)
 *   payment success rate  = 4/7
 *   payment failure rate  = 2/7
 *   cancellation rate     = 1/7
 *   completion rate       = 2/7
 *   average paid value    = 550000/4 = 137500
 */
export const GOLDEN_CURRENT_EXPECTED = {
  orders: 7,
  paidOrders: 4,
  paidOrderValueUgx: 550_000,
  grossOrderValueUgx: 820_000,
  discountValueUgx: 17_000,
  deliveryFeeValueUgx: 23_000,
  failedPayments: 2,
  completedOrders: 2,
  cancelledOrders: 1,
  paymentSuccessRate: 4 / 7,
  paymentFailureRate: 2 / 7,
  cancellationRate: 1 / 7,
  completionRate: 2 / 7,
  averagePaidOrderValueUgx: 137_500,
} as const;

/**
 * Hand calculation, previous window (GX G9 G10):
 *   orders = 3, paid = 2 (GX G9), paid value = 80000+200000 = 280000,
 *   failed = 1 (G10).
 */
export const GOLDEN_PREVIOUS_EXPECTED = {
  orders: 3,
  paidOrders: 2,
  paidOrderValueUgx: 280_000,
  failedPayments: 1,
} as const;

/** Non-zero Kampala-day buckets of the current period, hand-derived. */
export const GOLDEN_TREND_EXPECTED: Record<string, { orders: number; paidOrders: number; paidOrderValueUgx: number }> = {
  '2026-07-01': { orders: 1, paidOrders: 1, paidOrderValueUgx: 100_000 }, // G6 (21:30Z on 30 June)
  '2026-07-05': { orders: 2, paidOrders: 2, paidOrderValueUgx: 400_000 }, // G1 G2
  '2026-07-10': { orders: 1, paidOrders: 0, paidOrderValueUgx: 0 },       // G3
  '2026-07-15': { orders: 1, paidOrders: 0, paidOrderValueUgx: 0 },       // G4
  '2026-07-20': { orders: 1, paidOrders: 0, paidOrderValueUgx: 0 },       // G5
  '2026-07-31': { orders: 1, paidOrders: 1, paidOrderValueUgx: 50_000 },  // G7
};

export interface GoldenProduct {
  id: string;
  stockQuantity: number;
  reservedQuantity: number;
  reorderPoint: number;
  /** Hand-derived: available = max(stock - reserved, 0); low when reorder > 0 and available <= reorder. */
  expectedLow: boolean;
}

export const GOLDEN_PRODUCTS: GoldenProduct[] = [
  { id: 'P1', stockQuantity: 10, reservedQuantity: 8, reorderPoint: 5, expectedLow: true },   // available 2 <= 5
  { id: 'P2', stockQuantity: 100, reservedQuantity: 0, reorderPoint: 5, expectedLow: false }, // available 95
  { id: 'P3', stockQuantity: 3, reservedQuantity: 10, reorderPoint: 2, expectedLow: true },   // available clamps to 0
  { id: 'P4', stockQuantity: 0, reservedQuantity: 0, reorderPoint: 0, expectedLow: false },   // alert disabled
];

export const GOLDEN_LOW_STOCK_EXPECTED = 2;

export const GOLDEN_SEARCH_SIGNALS = [
  { query: 'router', searchCount: 60, zeroResultCount: 10 },
  { query: 'solar inverter 5kva', searchCount: 40, zeroResultCount: 15 },
];

/** total = 100, zero = 25, rate = 0.25 → above the 0.25 HIGH threshold. */
export const GOLDEN_SEARCH_EXPECTED = { totalSearches: 100, zeroResultSearches: 25, zeroResultRate: 0.25 } as const;
