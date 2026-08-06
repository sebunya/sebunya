/**
 * Payments operational configuration (payments brief, 2026-08-06).
 *
 * A closed registry, in the same discipline as the delivery module's: a key
 * outside this list cannot be written, and EVERY value ships unset. Unset
 * means the mechanism is OFF — a reservation with no TTL never expires, an
 * order with no abandonment window is never abandoned, a health alert with no
 * window never fires. Nothing changes until an operator sets a number, and no
 * number here was invented by a developer.
 */

export interface PaymentsOpsConfigEntry {
  key: string;
  type: 'integer' | 'clock';
  unit: string;
  min?: number;
  max?: number;
  label: string;
  help: string;
}

export const PAYMENTS_OPS_CONFIG_REGISTRY: readonly PaymentsOpsConfigEntry[] = [
  {
    key: 'reservation_ttl_hours',
    type: 'integer',
    unit: 'hours',
    min: 1,
    max: 720,
    label: 'How long an unpaid order may hold stock',
    help: 'A reservation on an order that has not been paid releases after this many hours, and the stock goes back on sale. Unset means reservations never expire — which is how 13 units came to be held by test orders for months.',
  },
  {
    key: 'order_abandonment_hours',
    type: 'integer',
    unit: 'hours',
    min: 1,
    max: 2160,
    label: 'When an unpaid order is considered abandoned',
    help: 'An order still unpaid after this many hours, with every payment attempt terminal or none ever made, is cancelled through the normal order lifecycle and its stock released. Unset means orders wait forever.',
  },
  {
    key: 'payment_health_alert_hours',
    type: 'integer',
    unit: 'hours',
    min: 1,
    max: 720,
    label: 'Alert when no successful payment lands within',
    help: 'The business-health alert: if no payment succeeds inside this window during trading hours, something is wrong with the shop even if every system is green. Unset means no alert — which is how a shop took no money for months and nothing said so.',
  },
  {
    key: 'trading_hours_start_eat',
    type: 'clock',
    unit: 'HH:MM East Africa Time',
    label: 'Trading day starts',
    help: 'The health alert only counts silence during trading hours. Unset means the whole day counts.',
  },
  {
    key: 'trading_hours_end_eat',
    type: 'clock',
    unit: 'HH:MM East Africa Time',
    label: 'Trading day ends',
    help: 'See trading day start. Unset means the whole day counts.',
  },
];

const BY_KEY = new Map(PAYMENTS_OPS_CONFIG_REGISTRY.map((e) => [e.key, e]));

export function isPaymentsOpsConfigKey(key: string): boolean {
  return BY_KEY.has(key);
}

export type PaymentsOpsValidation = { ok: true; value: number | string } | { ok: false; message: string };

export function validatePaymentsOpsValue(key: string, raw: string): PaymentsOpsValidation {
  const entry = BY_KEY.get(key);
  if (!entry) return { ok: false, message: `"${key}" is not a payments operational setting.` };
  const trimmed = raw.trim();
  if (entry.type === 'clock') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
      return { ok: false, message: `${entry.label} must be a 24-hour time like 08:30.` };
    }
    return { ok: true, value: trimmed };
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return { ok: false, message: `${entry.label} must be a whole number of ${entry.unit}.` };
  if (entry.min !== undefined && n < entry.min) return { ok: false, message: `${entry.label} cannot be below ${entry.min}.` };
  if (entry.max !== undefined && n > entry.max) return { ok: false, message: `${entry.label} cannot be above ${entry.max}.` };
  return { ok: true, value: n };
}
