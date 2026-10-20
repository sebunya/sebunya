import { includesSearchTerm } from './index';

/**
 * Query expansion shared by the header suggestions (API, SQL) and the /shop results page (web), 2026-10-20.
 *
 * Before this, every word had to appear exactly: "powerbank" found nothing while "power bank" found 11, and
 * "chager", "earpods" and "lapotp charger" all ended on the zero-results page. A query is now turned into GROUPS of
 * alternatives; a product matches when every group has one alternative in it. Each group comes from, in order:
 *   1. a synonym phrase shoppers use for something the shop names differently ("earpods" for earbuds);
 *   2. the word itself, when the catalogue has it (substring, so prefix typing keeps working);
 *   3. its singular ("batteries" -> battery);
 *   4. two catalogue words run together ("powerbank" -> "power bank");
 *   5. the nearest catalogue word within one or two typos, same first letter ("chager" -> charger).
 * A word none of these explain is UNKNOWN. A query whose every word is explained can still match nothing; a query
 * with an unknown word may be relaxed by the caller (drop the unknown words, say so) so one stray word does not
 * hide the products the rest of the query names.
 */

/**
 * Words shoppers in Kampala use for what the catalogue names differently. Each list is one meaning; the first entry
 * is the catalogue's own wording where it has one. Kept conservative: "adapter" is its own shelf and "wire" would
 * match "wired", so neither is a synonym of anything.
 */
export const SEARCH_SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['power bank', 'powerbank', 'power-bank', 'portable charger'],
  ['earbuds', 'earpods', 'airpods', 'ear buds', 'tws', 'wireless earphones'],
  ['earphones', 'earphone', 'handsfree', 'hands free', 'ear phones'],
  ['headphones', 'headphone', 'headset', 'over ear'],
  ['memory card', 'microsd', 'micro sd', 'sd card', 'tf card', 'memory chip'],
  ['flash disk', 'flash drive', 'flashdisk', 'flashdrive', 'pendrive', 'pen drive', 'usb stick', 'usb drive'],
  ['usb c', 'type c', 'type-c', 'typec', 'usb-c', 'usbc'],
  ['wall charger', 'home charger', 'plug charger'],
  ['cable', 'cord'],
];

export interface SearchCorrection {
  from: string;
  to: string;
}

export interface ExpandedSearchQuery {
  /** Every group must match; any one alternative in a group is enough. */
  groups: string[][];
  /** The query in the catalogue's own words, for "Showing results for …". Equals the input when nothing changed. */
  display: string;
  /** Typo fixes only (synonyms, plurals and joined words are not news to the shopper). */
  corrections: SearchCorrection[];
  /** Words nothing in the catalogue explains. */
  unknown: string[];
}

/** Word -> how often it occurs, from the text a search can match (names, categories, SKUs, models). */
export function buildSearchVocabulary(texts: Iterable<string | null | undefined>): Map<string, number> {
  const vocab = new Map<string, number>();
  for (const text of texts) {
    if (!text) continue;
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (word.length >= 2) vocab.set(word, (vocab.get(word) ?? 0) + 1);
    }
  }
  return vocab;
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps), stopping early past `max`. */
export function typoDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

const hasDigit = (w: string) => /[0-9]/.test(w);

function known(term: string, vocab: ReadonlyMap<string, number>): boolean {
  if (vocab.has(term)) return true;
  // Prefix and inner typing ("powerb", "arbud") keep matching as before.
  for (const word of vocab.keys()) if (includesSearchTerm(word, term)) return true;
  return false;
}

function singular(term: string): string | null {
  if (term.length < 4) return null;
  if (term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (term.endsWith('ses') || term.endsWith('xes') || term.endsWith('ches') || term.endsWith('shes')) return term.slice(0, -2);
  if (term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1);
  return null;
}

function split(term: string, vocab: ReadonlyMap<string, number>): string | null {
  if (term.length < 5 || hasDigit(term)) return null;
  for (let k = 2; k <= term.length - 2; k++) {
    const a = term.slice(0, k);
    const b = term.slice(k);
    if (vocab.has(a) && vocab.has(b) && !hasDigit(a) && !hasDigit(b)) return `${a} ${b}`;
  }
  return null;
}

function nearest(term: string, vocab: ReadonlyMap<string, number>): string | null {
  if (term.length < 4 || hasDigit(term)) return null;
  const max = term.length >= 7 ? 2 : 1;
  let best: { word: string; d: number; n: number } | null = null;
  for (const [word, n] of vocab) {
    if (word.length < 4 || hasDigit(word) || word[0] !== term[0]) continue;
    const d = typoDistance(term, word, max);
    if (d > max) continue;
    if (!best || d < best.d || (d === best.d && n > best.n)) best = { word, d, n };
  }
  return best?.word ?? null;
}

/** The variant of a synonym group the catalogue itself uses, so "Showing results for" speaks the shop's words. */
function catalogueVariant(group: ReadonlyArray<string>, vocab: ReadonlyMap<string, number>): string {
  return group.find((v) => v.split(/[\s-]+/).every((w) => vocab.has(w))) ?? group[0];
}

/**
 * `terms` are the normalised query words (searchTerms). Synonym phrases are found first, longest first, so
 * "wireless earphones" is the earbuds meaning before "earphones" alone is considered.
 */
export function expandSearchQuery(terms: readonly string[], vocab: ReadonlyMap<string, number>): ExpandedSearchQuery {
  const groups: string[][] = [];
  const shown: string[] = [];
  const corrections: SearchCorrection[] = [];
  const unknown: string[] = [];
  const variants = SEARCH_SYNONYM_GROUPS.flatMap((g) => g.map((v) => ({ group: g, words: v.split(/\s+/) })))
    .sort((a, b) => b.words.length - a.words.length);

  for (let i = 0; i < terms.length; ) {
    const hit = variants.find((v) => v.words.every((w, k) => terms[i + k] === w));
    if (hit) {
      groups.push([...hit.group]);
      shown.push(catalogueVariant(hit.group, vocab));
      i += hit.words.length;
      continue;
    }
    const term = terms[i++];
    if (term.length < 3 || hasDigit(term) || known(term, vocab)) {
      groups.push([term]);
      shown.push(term);
      continue;
    }
    const one = singular(term);
    if (one && known(one, vocab)) {
      groups.push([term, one]);
      shown.push(one);
      continue;
    }
    const joined = split(term, vocab);
    if (joined) {
      groups.push([term, joined]);
      shown.push(joined);
      continue;
    }
    const fixed = nearest(term, vocab) ?? (one ? nearest(one, vocab) : null);
    if (fixed) {
      groups.push([term, fixed]);
      shown.push(fixed);
      corrections.push({ from: term, to: fixed });
      continue;
    }
    groups.push([term]);
    shown.push(term);
    unknown.push(term);
  }
  return { groups, display: shown.join(' '), corrections, unknown };
}

/** The query without its unknown words, or null when that would leave nothing (or nothing was unknown). */
export function relaxSearchQuery(q: ExpandedSearchQuery): ExpandedSearchQuery | null {
  if (q.unknown.length === 0) return null;
  const groups = q.groups.filter((g) => !(g.length === 1 && q.unknown.includes(g[0])));
  if (groups.length === 0) return null;
  const display = q.display.split(' ').filter((w) => !q.unknown.includes(w)).join(' ');
  return { groups, display, corrections: q.corrections, unknown: [] };
}

/**
 * Every group matched by one of its alternatives. `extra` lets the web add its phone-brand lines
 * ("tecno" satisfied by "Spark 4") without the API needing them.
 */
export function matchesExpandedQuery(
  haystack: string,
  groups: readonly (readonly string[])[],
  extra?: (term: string, haystack: string) => boolean,
): boolean {
  return groups.every((g) => g.some((alt) => includesSearchTerm(haystack, alt) || (extra ? extra(alt, haystack) : false)));
}
