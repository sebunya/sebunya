import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A non-numeric quantity (a hand-made form value) was NaN, survived the clamp, and the cookie stored quantity null. */
describe('the cart quantity update', () => {
  const page = readFileSync(join(__dirname, '../../apps/web/src/pages/cart.astro'), 'utf8');
  // The same expressions the page uses, so the behaviour is checked, not only the text.
  const parse = (raw: string | null) => {
    const qty = Math.trunc(Number(raw || 1)) || 1;
    return Math.min(99, qty < 1 ? 1 : qty);
  };

  it('is always a whole number from 1 to 99', () => {
    expect(page).toContain("const qty = Math.trunc(Number(formData.get('quantity') || 1)) || 1;");
    expect(page).toContain('const validatedQty = Math.min(99, qty < 1 ? 1 : qty);');
    expect(parse('abc')).toBe(1);
    expect(parse('2.7')).toBe(2);
    expect(parse('0')).toBe(1);
    expect(parse('-4')).toBe(1);
    expect(parse('500')).toBe(99);
    expect(parse(null)).toBe(1);
    expect(parse('3')).toBe(3);
  });
});
