/**
 * Battery compatibility (0119) — the evidence rules and search logic, kept
 * pure so the unit tests exercise them with fake repositories.
 *
 * Non-negotiables:
 *  - A combination only reaches VERIFIED with an evidence source AND a note.
 *  - The public finder NEVER returns UNVERIFIED or REJECTED rows.
 *  - No invented compatibility: matching is exact-token matching over facts an
 *    operator recorded, never fuzzy guessing across brands.
 */

export const BATTERY_COMPAT_STATUSES = ['VERIFIED', 'PROVISIONAL', 'UNVERIFIED', 'REJECTED'] as const;
export type BatteryCompatStatus = (typeof BATTERY_COMPAT_STATUSES)[number];

export const BATTERY_EVIDENCE_SOURCES = ['MANUFACTURER_SHEET', 'SUPPLIER_SHEET', 'PHYSICAL_QA', 'CATALOGUE_EVIDENCE'] as const;
export type BatteryEvidenceSource = (typeof BATTERY_EVIDENCE_SOURCES)[number];

/** Statuses the public finder is allowed to surface — nothing else, ever. */
export const PUBLIC_BATTERY_STATUSES: readonly BatteryCompatStatus[] = ['VERIFIED', 'PROVISIONAL'];

/** The finder page may only be indexable once this many VERIFIED combinations exist. */
export const BATTERY_FINDER_INDEX_THRESHOLD = 5;

export const batteryFinderIndexable = (verifiedCount: number): boolean =>
  Number.isFinite(verifiedCount) && verifiedCount >= BATTERY_FINDER_INDEX_THRESHOLD;

export interface BatteryCompatInput {
  id?: string;
  phoneBrand: string;
  phoneModel: string;
  modelNumber?: string | null;
  variant?: string | null;
  batteryProductId?: string | null;
  batteryReference: string;
  status?: BatteryCompatStatus;
  evidenceSource?: BatteryEvidenceSource | null;
  evidenceNote?: string | null;
}

export type BatteryCompatValidation =
  | { ok: true; input: BatteryCompatInput }
  | { ok: false; code: string; message: string };

/**
 * Validation for create/edit/verify. VERIFIED demands evidenceSource + a
 * non-empty note — a claim without evidence stays PROVISIONAL/UNVERIFIED.
 */
export function validateBatteryCompatInput(raw: BatteryCompatInput): BatteryCompatValidation {
  const phoneBrand = (raw.phoneBrand ?? '').trim();
  const phoneModel = (raw.phoneModel ?? '').trim();
  const batteryReference = (raw.batteryReference ?? '').trim();
  if (!phoneBrand || !phoneModel || !batteryReference) {
    return { ok: false, code: 'BAD_INPUT', message: 'phoneBrand, phoneModel and batteryReference are required.' };
  }
  const status = raw.status ?? 'UNVERIFIED';
  if (!BATTERY_COMPAT_STATUSES.includes(status)) {
    return { ok: false, code: 'BAD_INPUT', message: `status must be one of ${BATTERY_COMPAT_STATUSES.join(', ')}.` };
  }
  if (raw.evidenceSource != null && !BATTERY_EVIDENCE_SOURCES.includes(raw.evidenceSource)) {
    return { ok: false, code: 'BAD_INPUT', message: `evidenceSource must be one of ${BATTERY_EVIDENCE_SOURCES.join(', ')}.` };
  }
  if (status === 'VERIFIED') {
    if (!raw.evidenceSource) {
      return { ok: false, code: 'EVIDENCE_REQUIRED', message: 'A combination cannot be VERIFIED without an evidence source.' };
    }
    if (!(raw.evidenceNote ?? '').trim()) {
      return { ok: false, code: 'EVIDENCE_REQUIRED', message: 'A combination cannot be VERIFIED without an evidence note describing what was checked.' };
    }
  }
  return {
    ok: true,
    input: {
      ...raw,
      phoneBrand,
      phoneModel,
      batteryReference,
      status,
      modelNumber: (raw.modelNumber ?? '')?.trim() || null,
      variant: (raw.variant ?? '')?.trim() || null,
      evidenceNote: (raw.evidenceNote ?? '')?.trim() || null,
    },
  };
}

// ── Search ──────────────────────────────────────────────────────────────────

export const BATTERY_FINDER_MAX_QUERY = 80;

/** Lowercased alphanumeric tokens; 'galaxy s21+' → ['galaxy','s21']. */
export function tokenizeBatteryQuery(q: string): string[] {
  return (q ?? '')
    .slice(0, BATTERY_FINDER_MAX_QUERY)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .slice(0, 8);
}

export interface BatteryCompatSearchRow {
  id: string;
  phoneBrand: string;
  phoneModel: string;
  modelNumber: string | null;
  variant: string | null;
  batteryReference: string;
  status: string;
  product: { id: string; name: string; slug: string; priceUgx: number; imageUrl: string | null } | null;
}

/**
 * Rank rows against tokens. Every token must match somewhere in the row's
 * fields (AND semantics — no partial-guess results); more specific matches
 * (model/model number) outrank brand-only ones.
 */
export function rankBatteryMatches(tokens: string[], rows: BatteryCompatSearchRow[]): BatteryCompatSearchRow[] {
  if (tokens.length === 0) return [];
  const scored = rows
    // Defence in depth: even if a repo hands us the wrong rows, the public
    // path never surfaces UNVERIFIED/REJECTED.
    .filter((r) => PUBLIC_BATTERY_STATUSES.includes(r.status as BatteryCompatStatus))
    .map((row) => {
      const fields: Array<[string, number]> = [
        [row.phoneModel.toLowerCase(), 4],
        [(row.modelNumber ?? '').toLowerCase(), 4],
        [row.batteryReference.toLowerCase(), 3],
        [(row.variant ?? '').toLowerCase(), 2],
        [row.phoneBrand.toLowerCase(), 1],
      ];
      let score = 0;
      for (const token of tokens) {
        let tokenScore = 0;
        for (const [field, weight] of fields) {
          if (field && field.includes(token)) tokenScore = Math.max(tokenScore, weight);
        }
        if (tokenScore === 0) return null; // AND semantics — a non-matching token disqualifies the row
        score += tokenScore;
      }
      if (row.status === 'VERIFIED') score += 2; // verified facts first
      return { row, score };
    })
    .filter((s): s is { row: BatteryCompatSearchRow; score: number } => s !== null)
    .sort((a, b) => b.score - a.score);
  return scored.map((s) => s.row);
}

export const batteryStatusLabel = (status: string): string =>
  status === 'VERIFIED' ? 'Verified fit' : 'Likely fit — confirm with us';

export interface BatteryFinderSearchResult {
  query: string;
  matches: Array<BatteryCompatSearchRow & { statusLabel: string }>;
  verifiedCount: number;
  indexable: boolean;
}

export interface BatteryFinderSearchDeps {
  /** VERIFIED + PROVISIONAL rows joined to in-stock products, pre-filtered by token overlap. */
  searchRows(tokens: string[]): Promise<BatteryCompatSearchRow[]>;
  countVerified(): Promise<number>;
  /** Fire-and-forget telemetry — a failure here must never fail the search. */
  recordEvent(e: { query: string; matched: boolean; matchCount: number }): Promise<void>;
}

export class SearchBatteryFinderUseCase {
  constructor(private readonly deps: BatteryFinderSearchDeps) {}

  async execute(rawQuery: string): Promise<BatteryFinderSearchResult> {
    const query = (rawQuery ?? '').trim().slice(0, BATTERY_FINDER_MAX_QUERY);
    const tokens = tokenizeBatteryQuery(query);
    const verifiedCount = await this.deps.countVerified();
    const matches = tokens.length === 0 ? [] : rankBatteryMatches(tokens, await this.deps.searchRows(tokens));
    if (query !== '') {
      // Every real search is telemetry — no-match queries are catalogue opportunities.
      void this.deps.recordEvent({ query, matched: matches.length > 0, matchCount: matches.length }).catch(() => undefined);
    }
    return {
      query,
      matches: matches.map((m) => ({ ...m, statusLabel: batteryStatusLabel(m.status) })),
      verifiedCount,
      indexable: batteryFinderIndexable(verifiedCount),
    };
  }
}
