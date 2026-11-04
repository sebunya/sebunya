/**
 * The ONE rule for "does this search word appear in this text", shared by the
 * header dropdown (API) and the /shop results page (web) so the two engines
 * cannot drift.
 *
 * A word is a plain substring match, so prefix typing ("powerb") and joined
 * words ("powerbank") keep working. A word that STARTS WITH A DIGIT must not be
 * the tail of a longer number: "2gb" must not find "32GB" or "512GB", and "8gb"
 * must not find "128GB". Both inputs are expected lower-cased already.
 */
export function includesSearchTerm(haystack: string, term: string): boolean {
  if (!term) return true;
  if (!/^[0-9]/.test(term)) return haystack.includes(term);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at < 0) return false;
    if (at === 0 || !/[0-9]/.test(haystack[at - 1])) return true;
    from = at + 1;
  }
}

/** Unit words a shopper types after a number, in the spelling the catalogue uses ("20 watt" → "20w"). */
const UNIT_WORDS: Readonly<Record<string, string>> = {
  mah: 'mah', w: 'w', watt: 'w', watts: 'w', gb: 'gb', tb: 'tb', mb: 'mb', v: 'v', a: 'a', mm: 'mm', hz: 'hz', ah: 'ah',
};

/**
 * Baymard Q1/Q3/Q7: the query words as the catalogue spells them. "10,000" loses its comma, "10000 mah" and "20 watt"
 * become one token ("10000mah", "20w"), "20watts" becomes "20w". Both engines (the API's searchTerms and /shop's
 * expandDiscoveryQuery) call this, so they cannot drift. Input is already lower-cased and split on whitespace.
 */
export function normalizeSearchWords(words: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    if (/^\d{1,3}(,\d{3})+[a-z]*$/.test(w)) w = w.replace(/,/g, '');
    const next = words[i + 1];
    if (/^\d+(\.\d+)?$/.test(w) && next !== undefined && Object.prototype.hasOwnProperty.call(UNIT_WORDS, next)) {
      out.push(`${w}${UNIT_WORDS[next]}`);
      i += 1;
      continue;
    }
    const unit = /^(\d+(?:\.\d+)?)(watts?|mah|gb|tb|mb)$/.exec(w);
    if (unit) w = `${unit[1]}${UNIT_WORDS[unit[2]] ?? unit[2]}`;
    out.push(w);
  }
  return out;
}

/** `term` present as a whole word: "car" in "car charger" but not in "memory card". Both inputs lower-cased. */
export function hasWholeSearchWord(haystack: string, term: string): boolean {
  if (!term) return true;
  // An index scan, not a built regex: the term is the shopper's own text.
  const wordChar = (ch: string | undefined) => ch !== undefined && /[a-z0-9]/.test(ch);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at < 0) return false;
    if (!wordChar(haystack[at - 1]) && !wordChar(haystack[at + term.length])) return true;
    from = at + 1;
  }
}

/**
 * The same rule as a PostgreSQL case-insensitive regular expression (`~*`), or
 * null when the plain ILIKE substring match already says the same thing.
 */
export function numericSearchTermPattern(term: string): string | null {
  if (!/^[0-9]/.test(term)) return null;
  return `(^|[^0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
}
export * from './queryExpansion';
