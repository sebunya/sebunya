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

export type FulfilmentAlertValidation = { ok: true; value: string } | { ok: false; message: string };

export function validateFulfilmentAlertValue(key: string, raw: string): FulfilmentAlertValidation {
  if (!isFulfilmentAlertConfigKey(key)) return { ok: false, message: `"${key}" is not a fulfilment alert setting.` };
  const trimmed = String(raw ?? '').trim();
  if (key === 'paid_order_sms_recipient') return normaliseUgandaMobile(trimmed);
  if (key === 'paid_order_sms_enabled') {
    if (trimmed !== 'true' && trimmed !== 'false') return { ok: false, message: 'Use "true" or "false".' };
    return { ok: true, value: trimmed };
  }
  return { ok: false, message: `"${key}" has no validation rule.` };
}

/** The alert is sent only when a recipient exists AND it is switched on. */
export function alertRecipient(values: Record<string, string>): string | null {
  const enabled = values.paid_order_sms_enabled === 'true';
  const recipient = (values.paid_order_sms_recipient ?? '').trim();
  return enabled && recipient ? recipient : null;
}
