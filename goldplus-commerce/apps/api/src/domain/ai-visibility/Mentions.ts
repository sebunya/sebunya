/**
 * Brand / entity MENTION detection in answer text.
 *
 * A mention means the answer names the entity. It is independent of whether
 * any of the entity's pages were CITATIONS (see Citations.ts) — the two are
 * never merged.
 *
 * Matching rules:
 *  - case-insensitive, Unicode-aware word boundaries: "Oraimo" matches
 *    "Oraimo's" and "(Oraimo)" but not "Oraimobile";
 *  - whitespace/hyphen/dot tolerant: "Gold Plus" matches "GoldPlus",
 *    "Gold-Plus" and "gold  plus";
 *  - a bare domain alias ("shopgoldplus.com") matches literally;
 *  - aliases shorter than 3 characters are ignored (too many false positives).
 */
export interface MentionEntity {
  id: string;
  name: string;
  aliases?: readonly string[];
}

export interface MentionHit {
  entityId: string;
  matchedText: string;
  /** Character offset of the first occurrence. */
  firstIndex: number;
  occurrences: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A pattern for one alias. Exported for tests. */
export function aliasPattern(alias: string): RegExp | null {
  const a = alias.trim();
  if (a.length < 3) return null;
  // Tokens split on spaces, hyphens, dots and underscores; between tokens allow
  // any run of those separators OR nothing ("Gold Plus" ~ "GoldPlus").
  const tokens = a.split(/[\s\-_.]+/).filter(Boolean).map(escape);
  if (tokens.length === 0) return null;
  const isDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(a);
  const body = isDomain ? escape(a) : tokens.join('[\\s\\-_.]*');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Domain labels that are ordinary words ("computers.co.ug"): never used as a brand alias. */
const GENERIC_LABELS = new Set(['computers', 'computer', 'phones', 'phone', 'mobile', 'gadgets', 'gadget', 'electronics', 'store', 'shop', 'online', 'market', 'mall', 'deals', 'tech']);
const QUALIFIERS = /\b(uganda|ug|kampala|east africa|africa|official|store|shop|online|outlet|direct|portal|ltd|limited)\b/gi;
/**
 * The names an answer would actually use for a competitor. Registry names are
 * descriptive ("Oraimo Uganda", "Samsung Uganda Direct", "Anker Uganda Outlet
 * (via Abanista)"); answers say "Oraimo", "Samsung", "Anker". Adds the name
 * without market/channel qualifiers and each website's brand label
 * ("ug.oraimo.com" -> "oraimo"). Labels under 4 characters are skipped — too
 * likely to match ordinary words (same floor Canonry uses).
 */
export function competitorMentionAliases(c: { name: string; aliases?: readonly string[]; domains?: readonly string[] }): string[] {
  const out = new Set<string>();
  for (const raw of [c.name, ...(c.aliases ?? [])]) {
    const base = raw.replace(/\(.*?\)/g, ' ').replace(QUALIFIERS, ' ').replace(/\s+/g, ' ').trim();
    if (base.length >= 3) out.add(base);
  }
  for (const d of c.domains ?? []) {
    const host = d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const parts = host.split('.');
    // the label before the public suffix: oraimo.com -> oraimo, ug.oraimo.com -> oraimo, jumia.co.ug -> jumia
    const suffixLen = parts.length >= 3 && parts[parts.length - 2].length <= 3 ? 2 : 1;
    const label = parts[parts.length - suffixLen - 1];
    if (label && label.length >= 4 && /^[a-z0-9-]+$/.test(label) && !GENERIC_LABELS.has(label)) out.add(label);
  }
  return [...out];
}

export function detectMentions(answerText: string | null | undefined, entities: readonly MentionEntity[]): MentionHit[] {
  const text = answerText ?? '';
  if (!text) return [];
  const hits: MentionHit[] = [];
  for (const e of entities) {
    let first = -1;
    let matched = '';
    let count = 0;
    for (const alias of [e.name, ...(e.aliases ?? [])]) {
      const rx = aliasPattern(alias);
      if (!rx) continue;
      for (const m of text.matchAll(rx)) {
        count += 1;
        if (first === -1 || (m.index ?? 0) < first) {
          first = m.index ?? 0;
          matched = m[0];
        }
      }
    }
    if (count > 0) hits.push({ entityId: e.id, matchedText: matched, firstIndex: first, occurrences: count });
  }
  return hits.sort((a, b) => a.firstIndex - b.firstIndex);
}
