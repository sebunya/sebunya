/**
 * Ugandan orthography folding (location-module brief PART F.2).
 *
 * Uganda writes the same place several ways — Lubaga/Rubaga, Matugga/Matuga,
 * Najjera/Najera, Entebbe/Ntebbe. This is a NORMALISATION FUNCTION, not a
 * synonym list: both the indexed text and the query are folded to one canonical
 * surface, then compared (exact / prefix / trigram).
 *
 * Design constraints proven by the unit suite:
 *  - every rule is tested with real names from the dataset, both directions
 *  - folding must NOT collapse genuinely distinct places — Bunga≠Busanga,
 *    Kasangati≠Kasana, Namasuba≠Namayuba each carry an explicit negative test
 *  - pure, deterministic, no I/O — safe for the client offline index and the
 *    server import alike.
 */

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
export function normaliseLocationText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/['’`´]/g, '') // ng' → ng
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-\s]+/g, ' ')
    .trim();
}

/**
 * Fold one normalised WORD to its canonical orthographic surface.
 * Order matters: doubled-consonant collapse runs before cluster rules so
 * `nny` → `ny` composes correctly.
 */
function foldWord(word: string): string {
  let w = word;

  // L and R interchange: fold both to `l` (lubaga==rubaga, kalerwe==karerwe).
  w = w.replace(/r/g, 'l');

  // ky/ki, by/bi, gy/gi before vowels: fold the glide to the vowel form so
  // kyebando==kiebando, and "ki-" spellings match "ky-" spellings.
  w = w.replace(/([kbg])y(?=[aeiou])/g, '$1i');

  // ng' (velar nasal) already lost its apostrophe in normalisation → ng.

  // Doubled consonants collapse: matugga==matuga, najjera==najera,
  // kajjansi==kajansi, ggaba==gaba, bbunga==bunga, kkonko==konko.
  w = w.replace(/([bcdfghjklmnpqstvwxyz])\1+/g, '$1');

  // Long vowels written single or double: naalya==nalya, kisaasi==kisasi.
  w = w.replace(/([aeiou])\1+/g, '$1');

  // `w` doubling inside vowel clusters (bunamwaaya) is covered by the vowel
  // collapse above; explicit ww fold for safety:
  w = w.replace(/ww/g, 'w');

  // Leading vowel may be dropped or added: entebbe==ntebbe. Fold by DROPPING a
  // leading vowel when it precedes a consonant cluster the language allows
  // word-initially only with the vowel (n+consonant, m+consonant).
  w = w.replace(/^[ae](?=[nm][a-z])/, '');

  // Terminal -e / -ye variance: kyebando==kyebandoe → strip a terminal `oe`→`o`
  // and terminal duplicate vowels are already collapsed; fold trailing "ye" to
  // "e" only when preceded by a vowel (kyebandoye → kyebandoe → handled above).
  w = w.replace(/([aeiou])ye$/, '$1e');
  w = w.replace(/oe$/, 'o');

  return w;
}

/**
 * Fold a full place string: normalise, then fold each word.
 * `foldUgandanOrthography('Matugga') === foldUgandanOrthography('Matuga')`.
 */
export function foldUgandanOrthography(raw: string): string {
  const normalised = normaliseLocationText(raw);
  if (!normalised) return '';
  return normalised
    .split(' ')
    .map(foldWord)
    .join(' ');
}

/**
 * The searchable surface stored in ug_area.search_text: folded name + folded
 * district + folded source spelling when it differs, space-joined so trigram
 * and prefix matching see every known surface of the place.
 */
export function buildSearchText(parts: Array<string | null | undefined>): string {
  const folded = parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => foldUgandanOrthography(p));
  return Array.from(new Set(folded)).join(' ');
}
