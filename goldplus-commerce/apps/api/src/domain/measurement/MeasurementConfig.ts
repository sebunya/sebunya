/**
 * Measurement settings (2026-10-23): a closed registry in the payments_ops_config discipline. A key outside this
 * list cannot be written. Unlike payments, two kinds of value exist: ones that ship UNSET and mean OFF (costs per
 * message, GA4 for assisted orders), and the holdout shares, which have a documented default so the programmes
 * measure themselves from the first deploy. Setting a holdout share to 0 switches that programme's holdout off.
 */
export interface MeasurementConfigEntry {
  key: string;
  type: 'integer' | 'ratio' | 'switch';
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
  { key: 'sms_cost_ugx_per_message', type: 'integer', unit: 'UGX', min: 1, max: 5000, label: 'SMS cost per message part', help: 'What the SMS provider charges per message. Unset: SMS carries no cost in the channel report or the marketing mix dataset.' },
  { key: 'whatsapp_cost_ugx_per_message', type: 'integer', unit: 'UGX', min: 1, max: 5000, label: 'WhatsApp cost per message', help: 'What Meta charges per delivered template message. Unset: WhatsApp carries no cost.' },
  { key: 'ugx_per_usd', type: 'integer', unit: 'UGX per USD', min: 1000, max: 20000, label: 'Shillings per US dollar (for spend)', help: 'Ad accounts bill in dollars; the marketing mix dataset and the derived costs need shillings. A platform\'s own rate on its advertising form wins; this is the fallback. Unset: dollar spend is left out and the dataset says so.' },
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
