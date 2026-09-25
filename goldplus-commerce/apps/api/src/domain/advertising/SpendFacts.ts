/**
 * Daily ad spend per channel and campaign, as it enters the ONE canonical
 * spend table (media_cost_facts, 0102). Pure: parsing, validation and money
 * conversion. Spend is never invented, defaulted or rounded into existence:
 * an unknown click or impression count stays null, never 0.
 */

export interface SpendFact {
  spendDate: string;
  channel: string;
  platform: string;
  account: string;
  /** Stable key: the platform's campaign id when there is one, else the name. */
  campaign: string;
  campaignLabel: string | null;
  currency: string;
  spendMinor: number;
  clicks: number | null;
  impressions: number | null;
  source: string;
}

/** ISO 4217 currencies with no minor unit (the rest used by our ad accounts have 2). */
const ZERO_DECIMAL = new Set(['UGX', 'RWF', 'BIF', 'JPY', 'KRW', 'VND', 'XAF', 'XOF', 'CLP', 'PYG', 'GNF', 'KMF', 'DJF', 'ISK', 'VUV', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
export const minorDigits = (currency: string): number => (ZERO_DECIMAL.has(currency) ? 0 : THREE_DECIMAL.has(currency) ? 3 : 2);

/** Google Ads cost_micros → minor units of the account currency (half-up). */
export function microsToMinor(micros: number | string, currency: string): number {
  const m = BigInt(String(micros).trim() || '0');
  const div = 10n ** BigInt(6 - minorDigits(currency));
  return Number((m + div / 2n) / div);
}

/**
 * A decimal amount string ("1234.56", "1,234.56", "150000") → minor units,
 * without floating point. Null when it is not a non-negative amount.
 */
export function decimalToMinor(amount: string, currency: string): number | null {
  const s = String(amount ?? '').trim().replace(/,(?=\d{3}(\D|$))/g, '');
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const d = minorDigits(currency);
  const frac = (m[2] ?? '').padEnd(d + 1, '0');
  let minor = BigInt(m[1]) * 10n ** BigInt(d) + BigInt(frac.slice(0, d) || '0');
  if (Number(frac[d] ?? '0') >= 5) minor += 1n; // half-up on the first dropped digit
  const n = Number(minor);
  return Number.isSafeInteger(n) ? n : null;
}

const MAX_SPEND_MINOR = 10_000_000_000; // the same per-row ceiling as the manual media-cost import
const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** One fact's validation; the reasons it is not a fact, or none. */
export function spendFactErrors(f: SpendFact, now: Date = new Date()): string[] {
  const e: string[] = [];
  if (!isRealDate(f.spendDate)) e.push('date must be a real YYYY-MM-DD date');
  else if (new Date(`${f.spendDate}T00:00:00Z`).getTime() > now.getTime()) e.push('date cannot be in the future');
  const caps: Array<[keyof SpendFact, number]> = [['channel', 40], ['platform', 80], ['account', 120], ['campaign', 150], ['source', 120]];
  for (const [k, cap] of caps) {
    const v = String(f[k] ?? '').trim();
    if (!v) e.push(`${k} is required`); else if (v.length > cap) e.push(`${k} is longer than ${cap} characters`);
  }
  if ((f.campaignLabel ?? '').length > 150) e.push('campaign name is longer than 150 characters');
  if (!/^[A-Z]{3}$/.test(f.currency)) e.push('currency must be a 3-letter code');
  if (!Number.isInteger(f.spendMinor) || f.spendMinor < 0 || f.spendMinor > MAX_SPEND_MINOR) e.push('spend must be a non-negative amount within a sane ceiling');
  for (const k of ['clicks', 'impressions'] as const) {
    const v = f[k];
    if (v !== null && (!Number.isInteger(v) || v < 0)) e.push(`${k} must be a whole number (or left blank when unknown)`);
  }
  return e;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC 4180 rows (quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Header aliases a platform export may use, lower-cased. */
const HEADERS: Record<string, string[]> = {
  date: ['date', 'day', 'reporting starts', 'spend_date'],
  channel: ['channel'],
  platform: ['platform', 'network'],
  account: ['account', 'account id', 'account_id', 'ad account'],
  campaign_id: ['campaign id', 'campaign_id'],
  campaign: ['campaign', 'campaign name', 'campaign_name'],
  spend: ['spend', 'cost', 'amount spent', 'amount_spent'],
  currency: ['currency'],
  clicks: ['clicks', 'link clicks'],
  impressions: ['impressions', 'impr.', 'impr'],
};

export interface CsvSpendResult {
  facts: SpendFact[];
  errors: Array<{ rowNumber: number; errors: string[] }>;
}

const intOrNull = (v: string | undefined): number | null | 'bad' => {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (s === '' || s === '--' || s === '—') return null;
  return /^\d+$/.test(s) ? Number(s) : 'bad';
};

/**
 * A spend CSV (the no-API fallback): header row, then one row per day and
 * campaign. Required: date, platform, campaign, spend, currency. Optional:
 * channel (defaults from the platform), account, campaign id, clicks,
 * impressions. The whole file is validated; a file that states the same
 * day+campaign twice contradicts itself and is refused.
 */
export function parseSpendCsv(text: string, now: Date = new Date()): CsvSpendResult {
  const rows = parseCsv(text);
  const errors: CsvSpendResult['errors'] = [];
  if (rows.length < 2) return { facts: [], errors: [{ rowNumber: 0, errors: ['the file needs a header row and at least one data row'] }] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (k: string) => header.findIndex((h) => HEADERS[k].includes(h));
  const idx = Object.fromEntries(Object.keys(HEADERS).map((k) => [k, col(k)])) as Record<string, number>;
  const missing = ['date', 'platform', 'campaign', 'spend', 'currency'].filter((k) => idx[k] < 0);
  if (missing.length) return { facts: [], errors: [{ rowNumber: 0, errors: [`missing column(s): ${missing.join(', ')}`] }] };
  if (rows.length - 1 > 5000) return { facts: [], errors: [{ rowNumber: 0, errors: ['at most 5,000 rows per file'] }] };
  const facts: SpendFact[] = [];
  const seen = new Map<string, number>();
  rows.slice(1).forEach((r, i) => {
    const rowNumber = i + 2;
    const get = (k: string) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const currency = get('currency').toUpperCase();
    const platform = get('platform');
    const spend = decimalToMinor(get('spend'), currency);
    const clicks = intOrNull(get('clicks'));
    const impressions = intOrNull(get('impressions'));
    const rowErrors: string[] = [];
    if (spend === null) rowErrors.push('spend must be a plain amount such as 150000 or 12.50');
    if (clicks === 'bad') rowErrors.push('clicks must be a whole number or blank');
    if (impressions === 'bad') rowErrors.push('impressions must be a whole number or blank');
    const campaignId = get('campaign_id');
    const name = get('campaign');
    const fact: SpendFact = {
      spendDate: get('date'), channel: get('channel') || channelForPlatform(platform), platform, account: get('account') || platform,
      campaign: campaignId ? `id:${campaignId}` : name, campaignLabel: campaignId ? name || null : null,
      currency, spendMinor: spend ?? -1, clicks: clicks === 'bad' ? null : clicks, impressions: impressions === 'bad' ? null : impressions, source: 'csv-upload',
    };
    rowErrors.push(...(spend === null ? spendFactErrors({ ...fact, spendMinor: 0 }, now) : spendFactErrors(fact, now)));
    const key = [fact.spendDate, fact.channel, fact.platform, fact.account, fact.campaign].join('|');
    if (seen.has(key)) rowErrors.push(`row ${seen.get(key)} already states this day and campaign`);
    else seen.set(key, rowNumber);
    if (rowErrors.length) errors.push({ rowNumber, errors: rowErrors });
    else facts.push(fact);
  });
  const currencies = [...new Set(facts.map((f) => f.currency))];
  if (currencies.length > 1) errors.push({ rowNumber: 0, errors: [`the file mixes ${currencies.join(', ')}; a cross-currency total is not a number, upload one currency per file`] });
  return { facts: errors.length ? [] : facts, errors };
}

/** The media-cost channel for a platform name, as the manual import uses them. */
export function channelForPlatform(platform: string): string {
  const p = platform.toLowerCase();
  if (/meta|facebook|instagram|tiktok|snap|pinterest|linkedin|x\b|twitter/.test(p)) return 'paid_social';
  if (/google|bing|microsoft/.test(p)) return 'paid_search';
  return 'paid_other';
}

/** Google Ads advertising_channel_type → media-cost channel. */
export function googleChannel(type: string | undefined): string {
  switch (type) {
    case 'SEARCH': return 'paid_search';
    case 'SHOPPING': return 'paid_shopping';
    case 'PERFORMANCE_MAX': return 'paid_pmax';
    case 'VIDEO': case 'DEMAND_GEN': return 'paid_video';
    case 'DISPLAY': return 'paid_display';
    default: return 'paid_other';
  }
}

/** Refuses a batch whose currency differs from spend already held (ROAS would become unanswerable). */
export function currencyConflict(batch: SpendFact[], existing: string[]): string | null {
  const cur = [...new Set(batch.map((f) => f.currency))];
  if (cur.length > 1) return `The import mixes ${cur.join(', ')}.`;
  const other = existing.filter((c) => c !== cur[0]);
  return cur.length === 1 && other.length ? `Spend already exists in ${other.join(', ')} and this import is ${cur[0]}; a cross-currency total is not a number. Nothing was written.` : null;
}
