/**
 * Measurement settings (2026-10-23): a closed registry in the payments_ops_config discipline. A key outside this
 * list cannot be written. Unlike payments, two kinds of value exist: ones that ship UNSET and mean OFF (costs per
 * message, GA4 for assisted orders), and the holdout shares, which have a documented default so the programmes
 * measure themselves from the first deploy. Setting a holdout share to 0 switches that programme's holdout off.
 */
/**
 * Meta's WhatsApp Business Platform USD rate card ("USD rates and volume tiers effective October 1, 2025"):
 * Uganda is priced under "Rest of Africa": marketing 0.0225, utility 0.0040, authentication 0.0040 per delivered
 * message. Checked 2026-10-23 against the published card; Meta revises it, so the figures are settings, not code.
 */
export const WHATSAPP_RATE_CARD = { region: 'Rest of Africa', effective: '2025-10-01', marketingUsd: 0.0225, utilityUsd: 0.004 } as const;
/** Owner 2026-10-23: default 3,800 shillings per dollar when no feed and no manual rate; feed rate + 100 otherwise. */
export const DEFAULT_UGX_PER_USD = 3800;
export const DEFAULT_FX_MARGIN_UGX = 100;

export interface MeasurementConfigEntry {
  key: string;
  type: 'integer' | 'ratio' | 'switch' | 'usd';
  unit: string;
  min?: number;
  max?: number;
  /** The value used when nothing is set; absent means unset = off. */
  defaultValue?: number;
  label: string;
  help: string;
}

export const MEASUREMENT_CONFIG_REGISTRY: readonly MeasurementConfigEntry[] = [
  { key: 'holdout_share_review_reminder', type: 'ratio', unit: 'share', min: 0, max: 0.5, defaultValue: 0.1, label: 'Review reminder holdout', help: 'Share of orders due a review reminder that are not sent one, so the reminder\'s effect on repeat buying can be measured. 0 sends to everyone.' },
  { key: 'holdout_share_loyalty_mission', type: 'ratio', unit: 'share', min: 0, max: 0.5, defaultValue: 0.1, label: 'Mission message holdout', help: 'Share of customers who complete a mission and are not told by message (the points are still awarded and visible in the account). 0 messages everyone.' },
  { key: 'holdout_share_loyalty_expiry', type: 'ratio', unit: 'share', min: 0, max: 0.5, defaultValue: 0, label: 'Points expiry warning holdout', help: 'The expiry warning was decided transactional (loyalty decision 15); it ships with no holdout. Set a share only if that decision changes.' },
  { key: 'holdout_share_abandoned_basket', type: 'ratio', unit: 'share', min: 0, max: 0.5, defaultValue: 0.1, label: 'Abandoned basket holdout', help: 'Applies the day abandoned-basket sends go live; the campaign engine records a HOLDOUT decision for this share.' },
  { key: 'holdout_share_campaign', type: 'ratio', unit: 'share', min: 0, max: 0.5, defaultValue: 0.1, label: 'Campaign holdout', help: 'Share of every live campaign audience held back as the control arm.' },
  { key: 'sms_cost_ugx_per_message', type: 'integer', unit: 'UGX', min: 1, max: 5000, defaultValue: 35, label: 'SMS cost per message part', help: 'What the SMS provider charges per message part. Owner\'s figure 2026-10-23: 35 shillings. Set 0 is not allowed; clear it to go back to the default.' },
  { key: 'whatsapp_marketing_usd_per_message', type: 'usd', unit: 'USD', min: 0, max: 1, defaultValue: WHATSAPP_RATE_CARD.marketingUsd, label: 'WhatsApp marketing message (dollars)', help: `Meta's published per-message rate for marketing templates to Ugandan numbers (${WHATSAPP_RATE_CARD.region}, rate card effective ${WHATSAPP_RATE_CARD.effective}). Converted to shillings at the dollar rate below.` },
  { key: 'whatsapp_utility_usd_per_message', type: 'usd', unit: 'USD', min: 0, max: 1, defaultValue: WHATSAPP_RATE_CARD.utilityUsd, label: 'WhatsApp utility message (dollars)', help: `Meta's published rate for utility and authentication templates (order updates, codes) to Ugandan numbers (${WHATSAPP_RATE_CARD.region}, effective ${WHATSAPP_RATE_CARD.effective}). Replies inside a customer-opened 24-hour window are free and are not sent as templates.` },
  { key: 'whatsapp_cost_ugx_per_message', type: 'integer', unit: 'UGX', min: 1, max: 5000, label: 'WhatsApp cost override (shillings, every message)', help: 'Only if Meta\'s invoice disagrees with the rate card: one shilling figure applied to every delivered template message, marketing and utility alike. Unset: the two dollar rates above apply.' },
  { key: 'ugx_per_usd', type: 'integer', unit: 'UGX per USD', min: 1000, max: 20000, defaultValue: DEFAULT_UGX_PER_USD, label: 'Shillings per US dollar (manual override)', help: `Leave unset: the nightly feed takes the day's market rate and adds the safety margin below. Set a number only to pin the rate by hand; it then wins over the feed. With no feed and nothing set, ${DEFAULT_UGX_PER_USD} is used. A platform's own rate on its advertising form wins over all of these for that platform's spend.` },
  { key: 'usd_ugx_margin', type: 'integer', unit: 'UGX', min: 0, max: 1000, defaultValue: DEFAULT_FX_MARGIN_UGX, label: 'Safety margin on the dollar rate', help: 'Added to the fed market rate so dollar spend is never understated in shillings (owner: +100).' },
  { key: 'ga4_reconciliation_tolerance_pct', type: 'integer', unit: '%', min: 1, max: 100, defaultValue: 20, label: 'GA4 reconciliation tolerance', help: 'When GA4 reports fewer purchases than we sent it by more than this share of a day, the nightly check raises an alarm.' },
  { key: 'ga4_assisted_orders', type: 'switch', unit: 'on/off', label: 'Send assisted orders to GA4', help: 'An order with no browser identity (placed with help from staff, or from a browser without the visitor cookie) is sent to GA4 under source "assisted", medium "staff". Unset: such orders never reach GA4 (they stay in the channel report).' },
];

const BY_KEY = new Map(MEASUREMENT_CONFIG_REGISTRY.map((e) => [e.key, e]));
export const isMeasurementConfigKey = (key: string): boolean => BY_KEY.has(key);
export type MeasurementConfigValidation = { ok: true; value: number | string } | { ok: false; message: string };

export function validateMeasurementValue(key: string, raw: string): MeasurementConfigValidation {
  const entry = BY_KEY.get(key);
  if (!entry) return { ok: false, message: `"${key}" is not a measurement setting.` };
  const trimmed = raw.trim();
  if (entry.type === 'switch') {
    if (!/^(on|off)$/i.test(trimmed)) return { ok: false, message: `${entry.label} must be "on" or "off".` };
    return { ok: true, value: trimmed.toLowerCase() };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: `${entry.label} must be a number of ${entry.unit}.` };
  if (entry.type === 'usd' && Math.round(n * 10000) !== n * 10000) return { ok: false, message: `${entry.label} takes at most four decimal places (Meta quotes to the tenth of a cent).` };
  if (entry.type === 'integer' && !Number.isInteger(n)) return { ok: false, message: `${entry.label} must be a whole number of ${entry.unit}.` };
  if (entry.min !== undefined && n < entry.min) return { ok: false, message: `${entry.label} cannot be below ${entry.min}.` };
  if (entry.max !== undefined && n > entry.max) return { ok: false, message: `${entry.label} cannot be above ${entry.max}.` };
  return { ok: true, value: n };
}

/** The effective number for a key: the stored value, else the registry default, else null (off). */
export function effectiveNumber(values: Record<string, string>, key: string): number | null {
  const entry = BY_KEY.get(key);
  if (!entry) return null;
  const raw = values[key];
  if (raw !== undefined) { const n = Number(raw); return Number.isFinite(n) ? n : entry.defaultValue ?? null; }
  return entry.defaultValue ?? null;
}
export const switchOn = (values: Record<string, string>, key: string): boolean => (values[key] ?? '').toLowerCase() === 'on';

/** The latest market rate the nightly feed stored, if any. */
export interface FxFeedReading { day: string; ugxPerUsd: number }
export const FX_FEED_MAX_AGE_DAYS = 7;

/**
 * Shillings per dollar for turning dollar spend and dollar message rates into shillings:
 *  1. a manual rate the owner typed in (ugx_per_usd) wins;
 *  2. else the newest feed reading at most 7 days old, plus the safety margin;
 *  3. else the documented default (3,800).
 * The answer says which, so the page and the dataset notes can say where a figure came from.
 */
export function resolveUgxPerUsd(values: Record<string, string>, feed: FxFeedReading | null, today: string): { rate: number; basis: 'manual' | 'feed' | 'default'; detail: string } {
  const manual = values['ugx_per_usd'] !== undefined ? Number(values['ugx_per_usd']) : NaN;
  if (Number.isFinite(manual) && manual > 0) return { rate: manual, basis: 'manual', detail: `set by hand` };
  const margin = effectiveNumber(values, 'usd_ugx_margin') ?? DEFAULT_FX_MARGIN_UGX;
  if (feed && feed.ugxPerUsd > 0 && daysBetween(feed.day, today) <= FX_FEED_MAX_AGE_DAYS) {
    return { rate: Math.round(feed.ugxPerUsd + margin), basis: 'feed', detail: `market ${feed.ugxPerUsd.toFixed(0)} on ${feed.day} + ${margin} margin` };
  }
  return { rate: DEFAULT_UGX_PER_USD, basis: 'default', detail: feed ? `feed reading from ${feed.day} is older than ${FX_FEED_MAX_AGE_DAYS} days` : 'no feed reading yet' };
}
const daysBetween = (a: string, b: string): number => Math.abs(Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000));

/** WhatsApp cost per delivered template message in shillings, by message class. */
export function whatsappCostUgx(values: Record<string, string>, ugxPerUsd: number): { marketing: number; utility: number; basis: 'override' | 'rate_card' } {
  const override = effectiveNumber(values, 'whatsapp_cost_ugx_per_message');
  if (override !== null) return { marketing: override, utility: override, basis: 'override' };
  const m = effectiveNumber(values, 'whatsapp_marketing_usd_per_message') ?? WHATSAPP_RATE_CARD.marketingUsd;
  const u = effectiveNumber(values, 'whatsapp_utility_usd_per_message') ?? WHATSAPP_RATE_CARD.utilityUsd;
  return { marketing: Math.ceil(m * ugxPerUsd), utility: Math.ceil(u * ugxPerUsd), basis: 'rate_card' };
}
