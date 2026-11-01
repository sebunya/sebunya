import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('order receipt (gap #7)', () => {
  const page = read('apps/web/src/pages/account/receipts/[id].astro');

  it('is the signed-in owner\'s own order, paid only, and never indexed', () => {
    expect(page).toContain('fetch(`${apiBase}/account/orders/${encodeURIComponent(id ?? \'\')}`');
    expect(page).toContain("if (order && !paid) problem = 'A receipt is ready once the order is paid.';");
    expect(page).toContain('robotsMeta="noindex,nofollow"');
  });

  it('shows the name and SKU at purchase, the price charged, and only arithmetic that adds up', () => {
    expect(page).toContain('item.nameAtPurchase ?? item.productName');
    expect(page).toContain('const addsUp = Boolean(order && r && r.subtotalUgx + r.deliveryFeeUgx === order.totalAmountUgx);');
    expect(page).toContain('Math.round(item.lineTotalUgx / item.quantity)');
  });

  it('says plainly it is not an EFRIS e-invoice, and prints through the browser', () => {
    expect(page).toContain('It is not a URA EFRIS e-invoice.');
    expect(page).toContain('data-action="print"');
  });

  it('the API returns the receipt figures from the order row and the payment', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts');
    expect(repo).toContain('select max(paid_at) as "paidAt" from payments where order_id = ${row.id} and paid_at is not null');
    expect(repo).toContain('discountUgx: (row as any).pricingDiscountTotal ?? 0,');
    expect(read('apps/web/src/pages/orders/[id].astro')).toContain("order.paymentStatus === 'paid' && <a href={`/account/receipts/${order.id}`}");
  });
});
