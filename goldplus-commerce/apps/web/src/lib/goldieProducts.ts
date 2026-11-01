/**
 * Which products go under an answer: the ones the answer names. A product is "named" when the text carries its
 * model code (GP-P07, PD-W3, GP03BT; "P07" alone counts), never because it shares words such as "20000mAh power
 * bank" with the one recommended (2026-10-14: recommending the GP-P02A also listed the GP-P07). A product with no
 * code in its name needs every significant word of its name in the text. The same rule runs on the API for
 * WhatsApp, Messenger and Instagram (domain/assistant/WhatsAppGoldie.productsToList).
 */
const MEASURE = /^\d+(\.\d+)?(mah|w|v|a|gb|tb|mb|m|cm|mm|hz|h|in|inch)$/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Model codes in a product name: tokens with letters and digits that are not a measurement (GP-P07 → gpp07, p07). */
export function productCodes(name: string): string[] {
  const out = new Set<string>();
  for (const raw of name.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g) ?? []) {
    if (!/\d/.test(raw) || !/[a-z]/i.test(raw) || MEASURE.test(raw.replace(/-/g, ''))) continue;
    if (/^usb-?c$/i.test(raw)) continue;
    out.add(norm(raw));
    const parts = raw.split('-');
    // "GP-P07" is often said "P07"; "PD-W3" → "W3". The last part only when it carries a digit and a letter.
    const tail = parts.length > 1 ? parts[parts.length - 1]! : '';
    if (tail && /\d/.test(tail) && /[a-z]/i.test(tail) && tail.length >= 2) out.add(norm(tail));
  }
  return [...out];
}

export function namedProducts<T extends { name: string }>(text: string, products: readonly T[], max: number): T[] {
  const tokens = new Set((text.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g) ?? []).flatMap((t) => [norm(t), ...t.split('-').map(norm)]));
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of products) {
    if (seen.has(p.name)) continue;
    const codes = productCodes(p.name);
    const hit = codes.length
      ? codes.some((c) => tokens.has(c))
      : (() => { const words = p.name.toLowerCase().replace(/[^a-z0-9. ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !MEASURE.test(w) && !/^(goldplus|the|and|for|with|power|bank|banks|charger|chargers|charging|cable|cables|earphones|earbuds|headphones|headset|speaker|wireless|wired|fast|usb|type|built|phone|phones|battery|replacement|display|digital|compact|magnetic|portable|mini|pro|new|original|black|white|blue|red)$/.test(w)); return words.length > 0 && words.every((w) => lower.includes(w)); })();
    if (hit) { out.push(p); seen.add(p.name); }
    if (out.length >= max) break;
  }
  return out;
}
