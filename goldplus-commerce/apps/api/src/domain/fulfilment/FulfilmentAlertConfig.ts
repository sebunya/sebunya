/**
 * Who is told, on a phone, that an order has been paid.
 *
 * A paid order nobody picks up is a customer waiting for goods they have
 * already paid for. Email cannot carry this today (the provider account is not
 * clear to send), and SMS is the channel proven to deliver in this market, so
 * the alert is an SMS.
 *
 * Closed registry, in the discipline of payments_ops_config: a key outside this
 * list cannot be written, and every value ships UNSET — unset means no alert is
 * sent, and the admin screen says so rather than implying one is on its way.
 */
export interface FulfilmentAlertConfigEntry {
  key: string;
  label: string;
  help: string;
}

export const FULFILMENT_ALERT_CONFIG_REGISTRY: readonly FulfilmentAlertConfigEntry[] = [
  {
    key: 'paid_order_sms_recipient',
    label: 'Phone to alert when an order is paid',
    help: 'A Ugandan mobile number. It receives one SMS the moment money is confirmed for an order, so somebody can start preparing it. Unset means no alert is sent.',
  },
  {
    key: 'paid_order_sms_enabled',
    label: 'Send the paid-order alert',
    help: 'Turn the alert off without losing the number. Unset means no alert is sent, and so does "false".',
  },
];

const BY_KEY = new Map(FULFILMENT_ALERT_CONFIG_REGISTRY.map((e) => [e.key, e]));
export const isFulfilmentAlertConfigKey = (key: string): boolean => BY_KEY.has(key);

/**
 * Ugandan mobile numbers, in the forms people actually type them, normalised to
 * one shape so the same phone cannot be stored three ways.
 */
export function normaliseUgandaMobile(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const digits = String(raw ?? '').replace(/[\s()\-.]/g, '');
  const m = /^(?:\+?256|0)(7\d{8})$/.exec(digits);
  if (!m) {
    return { ok: false, message: 'Enter a Ugandan mobile number, for example 0776004545 or +256776004545.' };
  }
  return { ok: true, value: `+256${m[1]}` };
}

export const MAX_ALERT_RECIPIENTS = 10;

/**
 * A list of numbers, however the operator separates them — commas, spaces or
 * new lines. Each is validated on its own, duplicates collapse, and ONE bad
 * entry fails the whole save rather than being dropped quietly: a number
 * silently missing from an alert list is a person who thinks they are being
 * told and is not.
 */
export function normaliseRecipientList(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const parts = String(raw ?? '').split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { ok: false, message: 'Enter at least one Ugandan mobile number.' };
  if (parts.length > MAX_ALERT_RECIPIENTS) {
    return { ok: false, message: `That is more than ${MAX_ALERT_RECIPIENTS} numbers. Keep the list short enough that somebody acts on it.` };
  }
  const out: string[] = [];
  for (const part of parts) {
    const one = normaliseUgandaMobile(part);
    if (!one.ok) return { ok: false, message: `"${part}" is not a Ugandan mobile number. Use a form like 0776004545 or +256776004545.` };
    if (!out.includes(one.value)) out.push(one.value);
  }
  return { ok: true, value: out.join(',') };
}

export type FulfilmentAlertValidation = { ok: true; value: string } | { ok: false; message: string };

export function validateFulfilmentAlertValue(key: string, raw: string): FulfilmentAlertValidation {
  if (!isFulfilmentAlertConfigKey(key)) return { ok: false, message: `"${key}" is not a fulfilment alert setting.` };
  const trimmed = String(raw ?? '').trim();
  if (key === 'paid_order_sms_recipient') return normaliseRecipientList(trimmed);
  if (key === 'paid_order_sms_enabled') {
    if (trimmed !== 'true' && trimmed !== 'false') return { ok: false, message: 'Use "true" or "false".' };
    return { ok: true, value: trimmed };
  }
  return { ok: false, message: `"${key}" has no validation rule.` };
}

/** Everyone who should be told, or nobody. Needs a list AND the switch. */
export function alertRecipients(values: Record<string, string>): string[] {
  if (values.paid_order_sms_enabled !== 'true') return [];
  return (values.paid_order_sms_recipient ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/** The first recipient, for callers that show a single example. */
export function alertRecipient(values: Record<string, string>): string | null {
  return alertRecipients(values)[0] ?? null;
}
