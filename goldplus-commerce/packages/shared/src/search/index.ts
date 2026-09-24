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

/**
 * The same rule as a PostgreSQL case-insensitive regular expression (`~*`), or
 * null when the plain ILIKE substring match already says the same thing.
 */
export function numericSearchTermPattern(term: string): string | null {
  if (!/^[0-9]/.test(term)) return null;
  return `(^|[^0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
}
