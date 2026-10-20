import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('Buy again (gap #13)', () => {
  const page = read('apps/web/src/pages/orders/[id].astro');

  it('adds the product as it is sold today, through the normal cart form', () => {
    expect(page).toContain('fetch(`${apiBase}/products/${encodeURIComponent(slug)}`');
    expect(page).toContain('<form method="POST" action="/cart" class="mt-2 flex flex-wrap items-center gap-2" data-buy-again>');
    expect(page).toContain('name="priceUgx" value={now.retailPriceUgx ?? 0}');
    expect(page).not.toContain('value={item.unitPriceUgx}');
  });

  it('offers nothing for a product no longer sold, unpriced or out of stock', () => {
    expect(page).toContain("p.retailPriceUgx > 0 && p.availability?.kind !== 'out_of_stock'");
  });

  it('delivered and completed orders link to it from the order list', () => {
    expect(read('apps/web/src/pages/account/orders.astro')).toContain("['delivered', 'completed'].includes(o.status) && <a href={`/orders/${o.id}#items`}");
  });
});
