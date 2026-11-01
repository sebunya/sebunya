/**
 * The battery listings' fit sentence (2026-10-29). The shop checks a fit when the customer asks, with their phone or
 * the code on their old battery; it does not confirm every order's fit before payment, and since 2026-10-28 (0211) a
 * fit from the supplier's compatibility list is shown as a fit, labelled as such. So a description offers the check;
 * it never states it as done. Used by scripts/reword-battery-fit-promise.ts on the live descriptions; the seed file
 * catalogue-copy-2026-09.json carries the same wording.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/ Match it to the code on your old battery; we confirm the fit before you pay\./g, ' Match it to the code on your old battery, or ask us and we confirm the fit before you order.'],
  [/ Fit confirmed before you pay\./g, ' Not sure it fits? Ask us and we confirm it before you order.'],
];

/** The unconditional sentences reworded as offers; everything else in the text is left as it is. */
export function rewordFitPromise(text: string): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

/** A fit stated as already confirmed, in any wording the rules know. */
export const UNCONDITIONAL_FIT_PROMISE = /fit confirmed before you pay|; we confirm the fit before you pay/i;
