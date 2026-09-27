/**
 * Operator STOP / unsubscribe intake. Zoho CPaaS does not deliver inbound
 * replies, so an operator who sees a STOP in the provider console records it
 * here through the existing POST /admin/consent-operating/provider-suppressions.
 * The endpoint demands provider evidence; the operator supplies it and attests
 * to authenticity and freshness explicitly (two checkboxes, never defaulted).
 */
export const STOP_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export type StopChannel = (typeof STOP_CHANNELS)[number];

export const STOP_VERIFICATION_PROFILE = 'operator_console_attestation';

export interface StopIntakeRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** phone:+2567XXXXXXXX (Ugandan numbers in E.164, digits otherwise) or email:lowercase. */
export function endpointRefFor(channel: StopChannel, contact: string): string | null {
  const raw = contact.trim();
  if (channel === 'email') {
    const email = raw.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `email:${email}` : null;
  }
  let digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `256${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('7')) digits = `256${digits}`;
  // "+256 0772…" — a trunk zero kept after the country code.
  if (digits.length === 13 && digits.startsWith('2560')) digits = `256${digits.slice(4)}`;
  // Only a full Ugandan mobile number can match the key the WhatsApp marketing
  // gate checks (normalisePhoneE164). Anything else would record a STOP that
  // never suppresses anyone, so it is refused instead.
  return /^2567\d{8}$/.test(digits) ? `phone:+${digits}` : null;
}

/** Lists never show a full phone number or email. */
export function maskEndpointRef(ref: unknown): string {
  const value = String(ref ?? '');
  const [kind, ...rest] = value.split(':');
  const id = rest.join(':');
  if (kind === 'phone') return `phone:${id.slice(0, 4)}•••••${id.slice(-3)}`;
  if (kind === 'email') {
    const [local = '', domain = ''] = id.split('@');
    return `email:${local.slice(0, 1)}•••@${domain}`;
  }
  if (kind === 'account') return 'account:•••';
  return value ? `${value.slice(0, 3)}•••` : '—';
}

export function buildStopIntakeRequest(
  form: { get(name: string): unknown },
  correlationId: string,
): { ok: true; request: StopIntakeRequest } | { ok: false; errors: string[] } {
  const text = (k: string) => String(form.get(k) ?? '').trim();
  const errors: string[] = [];
  const channel = text('channel') as StopChannel;
  if (!STOP_CHANNELS.includes(channel)) errors.push('Choose a channel.');
  const endpointRef = STOP_CHANNELS.includes(channel) ? endpointRefFor(channel, text('contact')) : null;
  if (!endpointRef) errors.push(channel === 'email' ? 'Enter a valid email address.' : 'Enter a Ugandan mobile number, for example 0772 123456.');
  const eventType = text('event_type') === 'unsubscribe' ? 'unsubscribe' : 'stop';
  const evidence = text('evidence');
  if (evidence.length < 5) errors.push('Describe the evidence (what the customer sent and where you saw it).');
  const providerEventRef = text('provider_event_ref');
  if (!providerEventRef) errors.push('Enter the provider message or ticket reference.');
  const occurred = text('provider_occurred_at');
  const occurredAt = occurred ? new Date(occurred) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) errors.push('Enter when the customer sent the message.');
  if (form.get('authenticity_verified') !== 'on') errors.push('Confirm you saw the message in the provider console.');
  if (form.get('freshness_verified') !== 'on') errors.push('Confirm the message is recent and has not been superseded.');
  const idempotencyKey = text('idempotency_key');
  if (!idempotencyKey) errors.push('The form is missing its idempotency key; reload the page.');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    request: {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Correlation-Id': correlationId,
      },
      body: {
        endpoint_ref: endpointRef,
        channel_key: channel,
        scope: 'channel',
        event_type: eventType,
        reason: evidence,
        provider_key: text('provider_key') || 'zoho_cpaas',
        provider_event_ref: providerEventRef,
        provider_callback_ref: `operator-intake:${idempotencyKey}`,
        provider_occurred_at: occurredAt!.toISOString(),
        authenticity_verified: true,
        freshness_verified: true,
        verification_profile: STOP_VERIFICATION_PROFILE,
      },
    },
  };
}
