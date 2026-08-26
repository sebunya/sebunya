/**
 * Battery code normalisation and source-line classification. Pure domain.
 *
 * A battery code is written many ways on packs, price lists and by customers:
 * "BL-49FT", "BL49FT", "bl 49ft", "GP-49FT", "49FT". Normalisation collapses
 * case, spaces and punctuation WITHOUT changing the displayed canonical code.
 * Resolution is exact on a small set of candidate forms; it never declares a
 * fit from a similar-looking code.
 */

export function normaliseBatteryCode(value: string): string {
  return value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

/** Common shop prefix on stock labels ("GP-49FT" is the shop's label for BL-49FT). */
const SHOP_PREFIX = 'GP';
/** Transsion (Tecno, Infinix, itel) battery family prefix. */
const TRANSSION_PREFIX = 'BL';

/**
 * Exact-match candidate forms for a typed code, most specific first. "49FT"
 * becomes ["49FT", "BL49FT"]; "GP-49FT" becomes ["GP49FT", "49FT", "BL49FT"].
 * Every candidate is still an EXACT key: a lookup that hits two different
 * batteries through two forms is ambiguous, not resolved.
 */
export function batteryCodeCandidates(query: string): string[] {
  const n = normaliseBatteryCode(query);
  if (!n) return [];
  const out = new Set<string>([n]);
  let core = n;
  if (core.startsWith(SHOP_PREFIX) && core.length > SHOP_PREFIX.length + 2) {
    core = core.slice(SHOP_PREFIX.length);
    out.add(core);
  }
  // Transsion codes are always two digits + two letters after "BL".
  if (/^\d{2}[A-Z]{2}$/.test(core)) out.add(`${TRANSSION_PREFIX}${core}`);
  if (core.startsWith(TRANSSION_PREFIX) && /^BL\d{2}[A-Z]{2}$/.test(core)) out.add(core.slice(2));
  return Array.from(out);
}

/** True when a string looks like one battery part code rather than a phone name. */
export function looksLikeBatteryCode(value: string): boolean {
  const n = normaliseBatteryCode(value);
  if (!n || n.length < 3 || n.length > 20) return false;
  if (/^BL\d{2}[A-Z]{2}$/.test(n)) return true;           // BL-49FT
  if (/^\d{2}[A-Z]{2}$/.test(n)) return true;               // 49FT
  if (/^BLP\d{3,4}$/.test(n)) return true;                   // BLP727 (OPPO)
  if (/^BL\d{3}$/.test(n)) return true;                      // BL-681 (OPPO shorthand for BLP681)
  if (/^EB[A-Z]{2}\d{3}[A-Z]{3}$/.test(n)) return true;      // EB-BA505ABU (Samsung)
  if (/^HQ\d{2}[A-Z]$/.test(n)) return true;                 // HQ-50S
  if (/^SLC\d{2}$/.test(n)) return true;
  if (/^WT\d{3}$/.test(n)) return true;                      // WT140 (Nokia)
  if (/^BL\d[A-Z]{1,2}$/.test(n)) return true;               // BL-4U, BL-5C, BL-4UL (Nokia)
  if (/^DC\d{4}$/.test(n)) return true;                      // DC3650
  return false;
}

export type SourceLineKind = 'CODE' | 'COMPOUND' | 'DEVICE_NAMED' | 'CODE_PLUS_DEVICE' | 'UNCLASSIFIED';

export interface SourceLineAnalysis {
  kind: SourceLineKind;
  /** The label with the shop prefix removed and whitespace collapsed. */
  cleaned: string;
  /** Candidate battery codes found in the line (display form, upper case). */
  codes: string[];
  /** Device words found in the line, when any. */
  deviceText: string | null;
  /** Why the line was classified the way it was. */
  reason: string;
}

const DEVICE_WORDS = new Set([
  'IP', 'IPHONE', 'NOTE', 'GALAXY', 'SAMSUNG', 'OPPO', 'NOKIA', 'BENCO', 'TECNO', 'INFINIX', 'ITEL', 'HUAWEI',
  'REDMI', 'XIAOMI', 'POP', 'SPARK', 'CAMON', 'SMART', 'HOT', 'PHANTOM', 'POUVOIR', 'ZERO', 'EDGE', 'PLUS',
  'PRO', 'PROMAX', 'MAX', 'CORE', 'WIFI', 'MIFI', 'ROUTER', 'BIG', 'SMALL', 'GRAND', 'PRIME', 'CX', 'AND',
]);

/** Model-name tokens like A32, A03, A57, S8, F9, C1, X, XR, 11 (a letter+digits or bare number). */
const DEVICE_MODEL_TOKEN = /^(?:[A-Z]\d{1,3}[A-Z]?|X|XR|XS|\d{1,2})$/;

/**
 * Classify one raw inventory label. Used by the raw-list importer and by the
 * regression fixtures for the known compound lines. This never invents a
 * code: a compound line is HELD, a device-named line becomes a DEVICE_NAMED
 * draft that cannot be published until the printed code is recorded.
 */
export function analyseSourceLine(raw: string): SourceLineAnalysis {
  const cleaned = raw
    .normalize('NFKD')
    .toUpperCase()
    .replace(/^\s*GP\s*-\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return { kind: 'UNCLASSIFIED', cleaned, codes: [], deviceText: null, reason: 'Empty label.' };

  // Parenthesised code, e.g. "OPPO F9(BL-681)".
  const paren = cleaned.match(/\(([^)]+)\)/);
  const withoutParen = cleaned.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  // A slash between code-like parts is a compound line: two references on one line.
  if (/\//.test(withoutParen)) {
    const parts = withoutParen.split('/').map((p) => p.trim()).filter(Boolean);
    const codeParts = parts.map((p) => p.split(' ')[0]);
    // "49CI / CT": the second part borrows the first part's digits.
    const allCodeLike = codeParts.every((p, i) => /^\d{1,2}[A-Z]{1,3}\d?$|^BL\d{1,2}[A-Z]{1,3}$/.test(normaliseBatteryCode(p)) || (i > 0 && /^[A-Z]{1,3}$/.test(normaliseBatteryCode(p))));
    if (allCodeLike && parts.length >= 2) {
      // "49CI / CT" shares the numeric prefix with its first part.
      const first = normaliseBatteryCode(codeParts[0]);
      const prefixDigits = first.match(/^(?:BL)?(\d{1,2})/)?.[1] ?? '';
      const codes = codeParts.map((p) => {
        const n = normaliseBatteryCode(p);
        return /^[A-Z]{1,3}$/.test(n) ? `${prefixDigits}${n}` : n;
      });
      return { kind: 'COMPOUND', cleaned, codes, deviceText: null, reason: 'One line combines two battery references.' };
    }
    // Device names combined ("A03/A04", "A20/A30/A50", "A32/5G") are not codes.
    return { kind: 'DEVICE_NAMED', cleaned, codes: [], deviceText: withoutParen, reason: 'Several device names on one line, no battery code.' };
  }

  const tokens = withoutParen.split(' ');
  const codeTokens = tokens.filter((t) => looksLikeBatteryCode(t) && !DEVICE_WORDS.has(t));
  const deviceTokens = tokens.filter((t) => DEVICE_WORDS.has(t) || DEVICE_MODEL_TOKEN.test(t));
  const parenCode = paren && looksLikeBatteryCode(paren[1]) ? [normaliseBatteryCode(paren[1])] : [];
  const codes = [...codeTokens.map(normaliseBatteryCode), ...parenCode];

  if (codes.length && deviceTokens.length) {
    return { kind: 'CODE_PLUS_DEVICE', cleaned, codes, deviceText: deviceTokens.join(' '), reason: 'A battery code with device names on the same line; each device claim needs its own review.' };
  }
  if (codes.length === 1 && tokens.length === 1) {
    return { kind: 'CODE', cleaned, codes, deviceText: null, reason: 'A single battery reference.' };
  }
  if (codes.length >= 1) {
    return { kind: 'CODE_PLUS_DEVICE', cleaned, codes, deviceText: tokens.filter((t) => !codeTokens.includes(t)).join(' ') || null, reason: 'A battery code with extra words.' };
  }
  if (deviceTokens.length) {
    return { kind: 'DEVICE_NAMED', cleaned, codes: [], deviceText: withoutParen, reason: 'The stock identifier is a phone name; the printed battery code is absent.' };
  }
  return { kind: 'UNCLASSIFIED', cleaned, codes: [], deviceText: null, reason: 'Could not tell whether this is a battery code or a device name.' };
}

/**
 * Known source conflicts from the 2026-08-26 audit (brief §8). These are held
 * for manual review even when a spreadsheet carries no status columns.
 */
export const KNOWN_CONFLICT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /NOTE\s*4\s*EDGE\s*PLUS/i, reason: "'Note 4 Edge Plus' is not a recognised Samsung model name." },
  { pattern: /NOTE\s*4\s*EDGE/i, reason: "'Note 4 Edge' is probably Galaxy Note Edge (SM-N915); confirm the printed battery code." },
  { pattern: /39LT9/i, reason: "'39LT9' looks like a typo of BL-39LT and its device claims conflict with the poster." },
  { pattern: /OPPO\s*A57/i, reason: 'OPPO A57 exists in 2016 and 2022 generations; the exact CPH model is required.' },
  { pattern: /\bA03\s*\/\s*A04\b/i, reason: 'Galaxy A03 and A04 are separate device families combined without a battery code.' },
  { pattern: /49FX/i, reason: 'BL-49FX is claimed across TECNO Pop 5 and Infinix Smart 6/7; each phone needs its own verification.' },
];

export function knownConflict(raw: string): string | null {
  for (const { pattern, reason } of KNOWN_CONFLICT_PATTERNS) if (pattern.test(raw)) return reason;
  return null;
}

/** MiFi and router labels from the source list belong in MIFI_ROUTER, not phone batteries. */
export function looksLikeRouterBattery(raw: string): boolean {
  return /\b(WIFI|MIFI|ROUTER|4G\s*WIFI)\b/i.test(raw);
}

/**
 * Display form of a code read from a stock label. A bare Transsion code
 * ("49FT") is written the way the pack prints it ("BL-49FT"); every other
 * family keeps its own form. The result stays PROVISIONAL until the pack
 * confirms it.
 */
export function displayCode(normalised: string): string {
  if (/^\d{2}[A-Z]{2}$/.test(normalised)) return `BL-${normalised}`;
  if (/^BL\d{2}[A-Z]{2}$/.test(normalised)) return `BL-${normalised.slice(2)}`;
  if (/^BL\d[A-Z]{1,2}$/.test(normalised)) return `BL-${normalised.slice(2)}`;
  if (/^BLP\d{3,4}$/.test(normalised)) return normalised;
  if (/^BL\d{3}$/.test(normalised)) return `BL-${normalised.slice(2)}`;
  if (/^EB[A-Z]{2}\d{3}[A-Z]{3}$/.test(normalised)) return `EB-${normalised.slice(2)}`;
  if (/^HQ\d{2}[A-Z]$/.test(normalised)) return `HQ-${normalised.slice(2)}`;
  return normalised;
}

/** A stable product SKU for a battery: the shop prefix + the normalised code. */
export function batterySku(canonicalCode: string): string {
  const n = normaliseBatteryCode(canonicalCode);
  return `GP-BAT-${n}`.slice(0, 50);
}

/** URL slug for a battery product. */
export function batterySlug(canonicalCode: string, brandHint?: string | null): string {
  const code = canonicalCode.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const brand = (brandHint ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = brand ? `${brand}-${code}-battery` : `${code}-battery`;
  return base.slice(0, 200);
}
