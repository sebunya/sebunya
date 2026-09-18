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
