/**
 * Matches photo filenames to products by the product code they contain.
 *
 * The owner names files by code ("GP-C10.webp", "gp-c10-2.jpg", "GoldPlus
 * earbuds GP-W04 front.png"); the price list stores the same codes as SKU and
 * model number with its own spacing ("GP - W04"). Matching is by whole tokens:
 * letter runs and digit runs are separate tokens, digit runs compare by VALUE
 * (gp-001 = GP01), separators are free, and a code never matches INSIDE another
 * token. The longest code contained wins; equal lengths tie (AMBIGUOUS). A
 * filename that names a KIND of product ("power bank") refuses a product of a
 * different kind, because the photo set and the price list have used different
 * schemes for the same number before. Pure: no I/O, fully unit-testable.
 */
export interface MatchableProduct { id: string; name: string; category: string; codes: string[] }
export interface PhotoPlan {
  matched: Array<{ file: string; productId: string; productName: string }>;
  unmatched: string[];
  ambiguous: Array<{ file: string; candidates: string[] }>;
  refused: Array<{ file: string; productName: string; reason: string }>;
}

export const tokens = (v: string): string[] => (v.toLowerCase().match(/[a-z]+|\d+/g) ?? []).map((t) => (/^\d+$/.test(t) ? String(Number(t)) : t));

/** The code without its "gp"/"gd" prefix: what must appear, in order, as whole tokens in the filename. */
export const codeKey = (code: string): string[] => {
  const t = tokens(code);
  const stripped = t[0] === 'gp' || t[0] === 'gd' ? t.slice(1) : t;
  return stripped.length ? stripped : t;
};

/** Does the code appear in the filename as whole tokens (with or without the gp prefix)? */
export const containsRun = (hay: string[], run: string[]): boolean => {
  if (run.length === 0) return false;
  const bare = run.join('');
  // A short bare key ('1', '4') would match almost any filename; only with its prefix.
  const want = new Set(bare.length >= 3 ? [bare, `gp${bare}`] : [`gp${bare}`]);
  for (let i = 0; i < hay.length; i += 1) {
    let acc = '';
    for (let j = i; j < hay.length && acc.length < 40; j += 1) { acc += hay[j]; if (want.has(acc)) return true; }
  }
  return false;
};

/** A word in the filename that names a KIND of product; used only to refuse a match, never to make one. */
const KIND: Array<[RegExp, RegExp]> = [
  [/power ?bank|powerbank/, /power bank/i], [/charger|charging/, /charger/i], [/cable/, /cable/i], [/earbud|earphone|headset|headphone/, /earphone|bluetooth|headset|earbud/i],
  [/speaker/, /speaker|bluetooth/i], [/mouse/, /mouse/i], [/sound ?card/, /sound card/i], [/memory ?card|sd ?card/, /memory card/i], [/flash ?drive|usb ?drive/, /flash drive/i],
  [/battery/, /battery/i], [/card ?reader/, /card reader/i], [/car /, /car /i],
];

export const IMAGE_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png', '.avif']);

export function productKeys(p: MatchableProduct): string[][] {
  return [...new Set(p.codes.map((c) => codeKey(c).join('-')).filter((k) => k.replace(/-/g, '').length >= 1))].map((k) => k.split('-'));
}

export function planPhotoAttachments(files: string[], products: MatchableProduct[]): PhotoPlan {
  const indexed = products.map((p) => ({ ...p, keys: productKeys(p) }));
  const plan: PhotoPlan = { matched: [], unmatched: [], ambiguous: [], refused: [] };
  for (const file of [...files].sort()) {
    const stem = file.replace(/\.[^.]+$/, '');
    const hay = tokens(stem);
    let best: Array<{ id: string; len: number }> = [];
    for (const p of indexed) for (const k of p.keys) {
      if (!containsRun(hay, k)) continue;
      const len = k.join('').length;
      if (!best.length || len > best[0].len) best = [{ id: p.id, len }];
      else if (len === best[0].len && !best.some((b) => b.id === p.id)) best.push({ id: p.id, len });
    }
    if (best.length === 0) { plan.unmatched.push(file); continue; }
    if (best.length > 1) { plan.ambiguous.push({ file, candidates: best.map((b) => indexed.find((p) => p.id === b.id)!.name) }); continue; }
    const product = indexed.find((p) => p.id === best[0].id)!;
    const spaced = stem.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    const kind = KIND.find(([inFile]) => inFile.test(spaced));
    if (kind && !kind[1].test(`${product.name} ${product.category}`)) { plan.refused.push({ file, productName: product.name, reason: 'the filename names a different kind of product' }); continue; }
    plan.matched.push({ file, productId: product.id, productName: product.name });
  }
  return plan;
}
