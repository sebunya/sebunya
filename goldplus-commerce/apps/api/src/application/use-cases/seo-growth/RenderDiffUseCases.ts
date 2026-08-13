import { buildAllowlist, isAllowedUrl } from './CrawlSiteUseCase';
/**
 * Raw vs rendered SEO diff (migration 0120).
 *
 * What a crawler that does NOT execute JavaScript sees (the raw HTML response)
 * against what a browser sees after rendering. The whole point is the honesty
 * of the negative case:
 *
 *  - If we never rendered the page, render_state is NOT_ATTEMPTED and severity
 *    is UNKNOWN. "We did not look" is never displayed as "no difference found".
 *  - There is NO headless browser in this repo. The renderer is an injected
 *    port; the shipped default implementation refuses honestly and says why.
 *
 * Extraction and comparison are pure functions so the tests run with neither a
 * network nor a browser.
 */

export const RENDER_STATES = ['NOT_ATTEMPTED', 'RENDERED', 'RENDER_FAILED', 'FETCH_FAILED'] as const;
export type RenderState = (typeof RENDER_STATES)[number];

export const DIFF_SEVERITIES = ['NONE', 'INFO', 'WARNING', 'CRITICAL', 'UNKNOWN'] as const;
export type DiffSeverity = (typeof DIFF_SEVERITIES)[number];

/** Fields whose JS-only appearance is a crawlability failure, not a nuance. */
export const CRITICAL_FIELDS = ['title', 'canonical', 'metaRobots'] as const;

/** A large content gap that warrants a warning rather than an informational note. */
export const WORD_COUNT_WARNING_DELTA = 100;
export const LINK_COUNT_WARNING_DELTA = 10;

export interface SeoFacts {
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  wordCount: number;
  linkCount: number;
  canonical: string | null;
  metaRobots: string | null;
  jsonLdCount: number;
}

export interface FactDifference {
  field: string;
  raw: string | number | null;
  rendered: string | number | null;
  severity: Exclude<DiffSeverity, 'NONE' | 'UNKNOWN'>;
}

/** The renderer port. There is deliberately no headless-browser dependency. */
export interface SeoPageRenderer {
  /** Fully rendered HTML for the URL, or a refusal describing why not. */
  render(url: string): Promise<RenderResult>;
}

export type RenderResult =
  | { rendered: true; html: string }
  | { rendered: false; state: Extract<RenderState, 'NOT_ATTEMPTED' | 'RENDER_FAILED'>; reason: string };

/**
 * The default renderer: no rendering engine is configured in this deployment,
 * so it reports NOT_ATTEMPTED with the reason. It never guesses, and it never
 * returns the raw HTML pretending to be rendered output.
 */
export class NotConfiguredSeoPageRenderer implements SeoPageRenderer {
  async render(_url: string): Promise<RenderResult> {
    return {
      rendered: false,
      state: 'NOT_ATTEMPTED',
      reason:
        'No rendering engine is configured. Raw HTML was captured, but the post-JavaScript view was not observed, so no difference verdict can be given.',
    };
  }
}

// ── Pure extraction ─────────────────────────────────────────────────────────

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");

const clean = (s: string | null): string | null => {
  if (s === null || s === undefined) return null;
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return t.length === 0 ? null : t;
};

/** Attribute value from a tag string, single/double quoted or bare. */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(tag);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

const stripNonText = (html: string): string =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

/**
 * Extract the SEO-relevant facts from an HTML string. Pure: no network, no DOM.
 * Regex parsing is adequate here because every field is a coarse signal used
 * only for comparison between two documents parsed the exact same way.
 */
export function extractSeoFacts(html: string): SeoFacts {
  const source = typeof html === 'string' ? html : '';
  const head = source;

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const h1Match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(source);

  let metaDescription: string | null = null;
  let metaRobots: string | null = null;
  for (const m of source.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (attr(tag, 'name') ?? '').toLowerCase();
    if (name === 'description' && metaDescription === null) metaDescription = attr(tag, 'content');
    if (name === 'robots' && metaRobots === null) metaRobots = attr(tag, 'content');
  }

  let canonical: string | null = null;
  for (const m of source.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().trim();
    if (rel === 'canonical') {
      canonical = attr(tag, 'href');
      break;
    }
  }

  const text = stripNonText(source)
    .replace(/<[^>]+>/g, ' ');
  const words = decodeEntities(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

  const linkCount = Array.from(source.matchAll(/<a\b[^>]*>/gi)).filter((m) => attr(m[0], 'href') !== null).length;

  const jsonLdCount = Array.from(source.matchAll(/<script\b[^>]*>/gi)).filter((m) => {
    const type = (attr(m[0], 'type') ?? '').toLowerCase();
    return type === 'application/ld+json';
  }).length;

  return {
    title: clean(titleMatch ? titleMatch[1] : null),
    metaDescription: clean(metaDescription),
    h1: clean(h1Match ? h1Match[1].replace(/<[^>]+>/g, ' ') : null),
    wordCount: words.length,
    linkCount,
    canonical: clean(canonical),
    metaRobots: clean(metaRobots),
    jsonLdCount,
  };
}

// ── Pure comparison ─────────────────────────────────────────────────────────

const TEXT_FIELDS: Array<{ key: keyof SeoFacts; label: string }> = [
  { key: 'title', label: 'title' },
  { key: 'canonical', label: 'canonical' },
  { key: 'metaRobots', label: 'metaRobots' },
  { key: 'metaDescription', label: 'metaDescription' },
  { key: 'h1', label: 'h1' },
];

const isCritical = (label: string): boolean => (CRITICAL_FIELDS as readonly string[]).includes(label);

export interface DiffVerdict {
  differences: FactDifference[];
  severity: DiffSeverity;
}

/**
 * Compare raw against rendered facts.
 *
 * Severity rules:
 *  - CRITICAL: title / canonical / meta robots that exist only AFTER rendering.
 *    A crawler that does not execute JavaScript never sees them at all.
 *  - WARNING: a large word-count or link-count gap, or a critical field whose
 *    value changed during rendering (both views exist but disagree).
 *  - INFO: every other small difference.
 *  - NONE: identical.
 * This function assumes rendering SUCCEEDED. When it did not, use
 * `verdictForRenderState`, which returns UNKNOWN.
 */
export function compareSeoFacts(raw: SeoFacts, rendered: SeoFacts): DiffVerdict {
  const differences: FactDifference[] = [];

  for (const { key, label } of TEXT_FIELDS) {
    const rawValue = (raw[key] ?? null) as string | null;
    const renderedValue = (rendered[key] ?? null) as string | null;
    if (rawValue === renderedValue) continue;
    const appearsOnlyAfterRender = rawValue === null && renderedValue !== null;
    const severity: FactDifference['severity'] = appearsOnlyAfterRender && isCritical(label)
      ? 'CRITICAL'
      : isCritical(label)
        ? 'WARNING'
        : 'INFO';
    differences.push({ field: label, raw: rawValue, rendered: renderedValue, severity });
  }

  const wordDelta = Math.abs((rendered.wordCount ?? 0) - (raw.wordCount ?? 0));
  if (wordDelta > 0) {
    differences.push({
      field: 'wordCount',
      raw: raw.wordCount ?? 0,
      rendered: rendered.wordCount ?? 0,
      severity: wordDelta >= WORD_COUNT_WARNING_DELTA ? 'WARNING' : 'INFO',
    });
  }

  const linkDelta = Math.abs((rendered.linkCount ?? 0) - (raw.linkCount ?? 0));
  if (linkDelta > 0) {
    differences.push({
      field: 'linkCount',
      raw: raw.linkCount ?? 0,
      rendered: rendered.linkCount ?? 0,
      severity: linkDelta >= LINK_COUNT_WARNING_DELTA ? 'WARNING' : 'INFO',
    });
  }

  if ((raw.jsonLdCount ?? 0) !== (rendered.jsonLdCount ?? 0)) {
    differences.push({
      field: 'jsonLdCount',
      raw: raw.jsonLdCount ?? 0,
      rendered: rendered.jsonLdCount ?? 0,
      severity: (raw.jsonLdCount ?? 0) === 0 ? 'WARNING' : 'INFO',
    });
  }

  if (differences.length === 0) return { differences, severity: 'NONE' };
  const rank: Record<FactDifference['severity'], number> = { INFO: 1, WARNING: 2, CRITICAL: 3 };
  let worst: FactDifference['severity'] = 'INFO';
  for (const d of differences) if (rank[d.severity] > rank[worst]) worst = d.severity;

  return { differences, severity: worst };
}

/**
 * The ONLY place a severity is chosen from a render state. Anything other than
 * RENDERED yields UNKNOWN — enforced again by the DB CHECK constraint.
 */
export function verdictForRenderState(state: RenderState, verdict?: DiffVerdict): DiffVerdict {
  if (state !== 'RENDERED') return { differences: [], severity: 'UNKNOWN' };
  return verdict ?? { differences: [], severity: 'NONE' };
}

/** Operator-facing sentence. Never says "no difference" when nothing was rendered. */
export function describeRenderState(state: RenderState, error?: string | null): string {
  switch (state) {
    case 'RENDERED':
      return 'Rendered view captured and compared.';
    case 'RENDER_FAILED':
      return `Rendering was attempted and failed — no comparison is possible.${error ? ` ${error}` : ''}`;
    case 'FETCH_FAILED':
      return `The raw HTML could not be fetched — nothing was compared.${error ? ` ${error}` : ''}`;
    case 'NOT_ATTEMPTED':
    default:
      return `Rendering was not attempted — this is NOT a finding of "no difference".${error ? ` ${error}` : ''}`;
  }
}

// ── The use case ────────────────────────────────────────────────────────────

export interface RawFetchResult {
  status: number;
  body: string | null;
}

export interface RawSeoFetcher {
  fetchPage(url: string): Promise<{ status: number; body: string | null }>;
}

export interface RenderDiffRecord {
  url: string;
  renderState: RenderState;
  rawStatus: number | null;
  raw: SeoFacts | null;
  rendered: SeoFacts | null;
  differences: FactDifference[];
  severity: DiffSeverity;
  error: string | null;
}

export interface RenderDiffStore {
  saveRenderDiff(record: RenderDiffRecord): Promise<any>;
}

/** URLs must be absolute http(s). No file://, no internal schemes. */
export function normaliseDiffUrl(raw: unknown, allowlist?: string[]): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // SSRF gate. Without it, an operator with SEO_AUDIT_RUN could point the
    // diff at http://169.254.169.254/ (cloud metadata) or a localhost service
    // and read the response back out of the SEO console. Reuses the crawler's
    // allowlist so both fetchers obey one rule; IP literals are never allowed,
    // because an allowlist keyed on hostnames cannot vet them.
    if (!isAllowedUrl(u.toString(), allowlist ?? buildAllowlist())) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Fetch raw HTML, attempt a render through the injected port, compare, persist.
 * Every failure mode produces a stored row with an honest state, because a
 * missing row would be indistinguishable from "checked and clean".
 */
export class RunRenderDiffUseCase {
  constructor(
    private readonly fetcher: RawSeoFetcher,
    private readonly renderer: SeoPageRenderer,
    private readonly store: RenderDiffStore,
  ) {}

  async execute(input: { url: string }): Promise<RenderDiffRecord> {
    const url = normaliseDiffUrl(input?.url);
    if (!url) {
      throw new Error('A render diff needs an absolute http(s) URL.');
    }

    let rawStatus: number | null = null;
    let rawHtml: string | null = null;
    try {
      const res = await this.fetcher.fetchPage(url);
      rawStatus = typeof res?.status === 'number' ? res.status : null;
      rawHtml = typeof res?.body === 'string' ? res.body : null;
    } catch (err) {
      const record: RenderDiffRecord = {
        url, renderState: 'FETCH_FAILED', rawStatus: null, raw: null, rendered: null,
        differences: [], severity: 'UNKNOWN', error: (err as Error)?.message ?? 'Fetch failed.',
      };
      await this.store.saveRenderDiff(record);
      return record;
    }

    if (rawHtml === null) {
      const record: RenderDiffRecord = {
        url, renderState: 'FETCH_FAILED', rawStatus, raw: null, rendered: null,
        differences: [], severity: 'UNKNOWN',
        error: 'No HTML body was returned for the raw request.',
      };
      await this.store.saveRenderDiff(record);
      return record;
    }

    const raw = extractSeoFacts(rawHtml);

    let renderResult: RenderResult;
    try {
      renderResult = await this.renderer.render(url);
    } catch (err) {
      renderResult = { rendered: false, state: 'RENDER_FAILED', reason: (err as Error)?.message ?? 'Renderer threw.' };
    }

    if (!renderResult.rendered) {
      const record: RenderDiffRecord = {
        url, renderState: renderResult.state, rawStatus, raw, rendered: null,
        ...verdictForRenderState(renderResult.state),
        error: renderResult.reason,
      };
      await this.store.saveRenderDiff(record);
      return record;
    }

    const rendered = extractSeoFacts(renderResult.html);
    const verdict = verdictForRenderState('RENDERED', compareSeoFacts(raw, rendered));
    const record: RenderDiffRecord = {
      url, renderState: 'RENDERED', rawStatus, raw, rendered,
      differences: verdict.differences, severity: verdict.severity, error: null,
    };
    await this.store.saveRenderDiff(record);
    return record;
  }
}
