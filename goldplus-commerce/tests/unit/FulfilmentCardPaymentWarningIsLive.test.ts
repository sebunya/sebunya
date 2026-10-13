import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A fulfilment task stores the warnings it was created with. "Payment not yet
 * confirmed" was written when an unpaid order was placed and stayed after the
 * money arrived, so the card read "Paid" and "Payment not yet confirmed" at
 * once (seen live on GP-202609-0B3BA402, 2026-10-13). The card now derives the
 * payment line from the live payment status. Pinned on the page source, the
 * repo's convention for admin pages; the function is extracted and run.
 */
const src = readFileSync(resolve(__dirname, '../../apps/web/src/pages/admin/fulfilment/index.astro'), 'utf8');
const fnSrc = src.slice(src.indexOf('const PAYMENT_WARNING'), src.indexOf('\n}\n', src.indexOf('function liveWarnings')) + 2)
  .replace(/: \{ paymentStatus: string; warnings: string\[\] \}\): string\[\]/, ')').replace(/\(task\)/, '(task)');
// eslint-disable-next-line no-new-func
const liveWarnings = new Function(`${fnSrc.replace('function liveWarnings(task', 'return function liveWarnings(task')}`)() as (t: { paymentStatus: string; warnings: string[] }) => string[];

describe('the fulfilment card judges payment by the order as it is now', () => {
  const stored = ['Delivery fee not from a configured zone — confirm before dispatch.', 'Payment not yet confirmed — do not dispatch until paid.'];

  it('a paid order shows no payment warning, whatever was stored at placement', () => {
    expect(liveWarnings({ paymentStatus: 'paid', warnings: stored })).toEqual([stored[0]]);
  });

  it('an unpaid order shows one payment line that is true for pay on delivery too', () => {
    const w = liveWarnings({ paymentStatus: 'pending', warnings: stored });
    expect(w).toHaveLength(2);
    expect(w[1]).toMatch(/collect the money when you hand it over/);
  });

  it('the card renders the live list, not the stored one', () => {
    expect(src).toMatch(/liveWarnings\(task\)\.map/);
    expect(src).not.toMatch(/task\.warnings\.map/);
  });
});
