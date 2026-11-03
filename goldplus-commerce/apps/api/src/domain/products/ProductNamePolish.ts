/**
 * Display-name tidy-up for names built as "GoldPlus <Category> <price-list code>" (scripts/polish-product-names.ts).
 * The price list's codes carry their own category suffix (PB, MC, F, CH, BT), so "GoldPlus Power Bank GP-P07 PB"
 * loses the suffix the category word already says, and "TYPE C" is written the way people write it. Pure.
 */
export function polishProductName(name: string): string {
  let n = name;
  n = n.replace(/^(GoldPlus Power Bank .*?)\s+PB$/, '$1').replace(/^(GoldPlus Memory Card .*?)\s+MC$/, '$1').replace(/^(GoldPlus Flash Drive .*?)\s+F$/, '$1')
       .replace(/^(GoldPlus Charger .*?)\s+CH$/, '$1').replace(/^(GoldPlus Bluetooth .*?)\s+BT$/, '$1');
  // The "C TO ..." phrases first, each swallowing a leading "TYPE ", and never starting inside "Type-C" (the
  // hyphen is a word boundary), so "TYPE C TO IPHONE" becomes "Type-C to iPhone", not "Type-Type-C to iPhone".
  n = n.replace(/(?<![\w-])(?:TYPE )?C TO C\b/, 'Type-C to Type-C').replace(/(?<![\w-])(?:TYPE )?C TO IPHONE\b/, 'Type-C to iPhone')
       .replace(/\bTYPE C\b/, 'Type-C').replace(/\bTYPE PIN\b/, 'Pin').replace(/\bUNIVERSAL CH\b/, 'Universal');
  return n.replace(/\s+/g, ' ').trim();
}
