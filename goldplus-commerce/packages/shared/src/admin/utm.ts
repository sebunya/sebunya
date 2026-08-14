/**
 * Campaign URL construction.
 *
 * This module needed no external analytics credential and never did — building
 * a tagged URL is string work over a URL the operator supplies. The page said
 * "Parameter Builder Unconnected" and pointed operators at static labels
 * elsewhere, which was a description of an unfinished implementation rather
 * than a real dependency.
 *
 * Pure and deterministic, so the same inputs always produce the same URL and
 * the behaviour is provable without a browser.
 */

export const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'] as const;
export type UtmParam = (typeof UTM_PARAMS)[number];

export interface UtmInput {
  url: string;
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
  id?: string;
  /**
   * Lower-cases and hyphenates parameter values. On by default because mixed
   * casing silently splits one campaign into several rows in every analytics
   * tool — "Facebook" and "facebook" do not aggregate.
   */
  normalizeValues?: boolean;
}

export interface UtmIssue {
  field: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface UtmResult {
  ok: boolean;
  url: string | null;
  issues: UtmIssue[];
  /** Parameters that were already present and have been replaced. */
  replaced: string[];
  /** Non-UTM query parameters carried through untouched. */
  preserved: string[];
}

/** Analytics tools treat these as distinct values, so we normalise. */
export function normalizeUtmValue(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

const REQUIRED: Array<[keyof UtmInput, UtmParam, string]> = [
  ['source', 'utm_source', 'Source'],
  ['medium', 'utm_medium', 'Medium'],
  ['campaign', 'utm_campaign', 'Campaign'],
];

const OPTIONAL: Array<[keyof UtmInput, UtmParam]> = [
  ['content', 'utm_content'],
  ['term', 'utm_term'],
  ['id', 'utm_id'],
];

export function buildUtmUrl(input: UtmInput): UtmResult {
  const issues: UtmIssue[] = [];
  const replaced: string[] = [];
  const preserved: string[] = [];
  const normalize = input.normalizeValues !== false;

  const raw = String(input.url ?? '').trim();
  if (raw === '') {
    return { ok: false, url: null, replaced, preserved,
      issues: [{ field: 'url', severity: 'ERROR', message: 'Enter the destination URL you want to tag.' }] };
  }

  // A bare domain is a reasonable thing to paste, so assume https for input
  // that carries NO scheme at all. Anything that does declare a scheme keeps
  // it and must pass the http(s) check below — otherwise prefixing would turn
  // `javascript:alert(1)` into a valid https URL and defeat the check entirely.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  const candidate = hasScheme ? raw : `https://${raw}`;

  let target: URL;
  try {
    target = new URL(candidate);
  } catch {
    return { ok: false, url: null, replaced, preserved,
      issues: [{ field: 'url', severity: 'ERROR', message: 'That is not a valid URL.' }] };
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, url: null, replaced, preserved,
      issues: [{ field: 'url', severity: 'ERROR', message: 'Only http and https links can be tagged.' }] };
  }
  // The URL parser is lenient about hostnames — "ht!tp" parses happily — so a
  // shape check is needed for input that was never a URL to begin with.
  const HOSTNAME = /^(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/i;
  if (target.hostname === '' || !HOSTNAME.test(target.hostname)) {
    return { ok: false, url: null, replaced, preserved,
      issues: [{ field: 'url', severity: 'ERROR', message: 'That is not a valid URL.' }] };
  }
  if (target.protocol === 'http:') {
    issues.push({ field: 'url', severity: 'WARNING', message: 'This is an http link. Most destinations redirect to https, which can drop parameters.' });
  }

  const values: Partial<Record<UtmParam, string>> = {};
  for (const [key, param, label] of REQUIRED) {
    const v = normalize ? normalizeUtmValue(String(input[key] ?? '')) : String(input[key] ?? '').trim();
    if (v === '') {
      issues.push({ field: param, severity: 'ERROR', message: `${label} is required — without it the traffic cannot be attributed.` });
    } else {
      values[param] = v;
    }
  }
  for (const [key, param] of OPTIONAL) {
    const v = normalize ? normalizeUtmValue(String(input[key] ?? '')) : String(input[key] ?? '').trim();
    if (v !== '') values[param] = v;
  }

  if (issues.some((i) => i.severity === 'ERROR')) {
    return { ok: false, url: null, issues, replaced, preserved };
  }

  // Record what was already on the URL before we touch it: replacing an
  // existing utm_source silently is exactly how a campaign gets mis-attributed.
  for (const [k] of target.searchParams) {
    if ((UTM_PARAMS as readonly string[]).includes(k)) {
      if (!replaced.includes(k)) replaced.push(k);
    } else if (!preserved.includes(k)) {
      preserved.push(k);
    }
  }
  for (const p of UTM_PARAMS) target.searchParams.delete(p);
  for (const p of UTM_PARAMS) {
    const v = values[p];
    if (v !== undefined) target.searchParams.set(p, v);
  }

  if (replaced.length > 0) {
    issues.push({ field: 'url', severity: 'WARNING',
      message: `Replaced parameters already on the link: ${replaced.join(', ')}.` });
  }
  if (target.hash) {
    issues.push({ field: 'url', severity: 'WARNING',
      message: 'The link has a #fragment. Some tools drop parameters after it.' });
  }

  return { ok: true, url: target.toString(), issues, replaced, preserved };
}

/** Conventional mediums, offered as guidance rather than enforced. */
export const COMMON_MEDIUMS = ['cpc', 'email', 'social', 'organic', 'referral', 'affiliate', 'display', 'sms', 'push'] as const;

export function reviewTaxonomy(input: { source: string; medium: string; campaign: string }): UtmIssue[] {
  const issues: UtmIssue[] = [];
  const medium = normalizeUtmValue(input.medium);
  if (medium && !(COMMON_MEDIUMS as readonly string[]).includes(medium)) {
    issues.push({ field: 'utm_medium', severity: 'WARNING',
      message: `"${medium}" is not one of the conventional mediums (${COMMON_MEDIUMS.join(', ')}). Reports group by medium, so an unusual value will sit on its own row.` });
  }
  if (normalizeUtmValue(input.source) === normalizeUtmValue(input.campaign) && input.source) {
    issues.push({ field: 'utm_campaign', severity: 'WARNING',
      message: 'Source and campaign are identical, which makes it impossible to tell campaigns apart later.' });
  }
  return issues;
}
