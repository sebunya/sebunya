/**
 * Transactional administrator order email — pure domain (no Hono/Drizzle/provider).
 *
 * One email intent per order event. The message is truthful about payment AND
 * stock: READY_FOR_PREPARATION is shown only when payment is confirmed and stock
 * is confirmed. Payment confirmation never clears an inventory hold.
 */

export type AdminOrderEmailEvent = 'placed' | 'payment-confirmed' | 'cancelled';

export type AdminPreparationState =
  | 'READY_FOR_PREPARATION'
  | 'AWAITING_PAYMENT'
  | 'ON_HOLD_STOCK'
  | 'BACKORDERED'
  | 'CANCELLED';

export function buildAdminEmailIdempotencyKey(orderId: string, event: AdminOrderEmailEvent): string {
  return `order:${orderId}:admin-email:${event}`;
}

/**
 * Truthful preparation state. Both payment and stock must be confirmed to reach
 * READY_FOR_PREPARATION. Cancellation wins over everything.
 */
export function deriveAdminPreparationState(input: {
  event: AdminOrderEmailEvent;
  paymentConfirmed: boolean;
  stockConfirmed: boolean;
}): AdminPreparationState {
  if (input.event === 'cancelled') return 'CANCELLED';
  if (!input.stockConfirmed) return 'ON_HOLD_STOCK';
  if (!input.paymentConfirmed) return 'AWAITING_PAYMENT';
  return 'READY_FOR_PREPARATION';
}

export type AdminRecipientState = 'READY' | 'MISSING_CONFIG';

export interface AdminRecipientConfig {
  recipients: string[];
  state: AdminRecipientState;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a comma/semicolon/space list of admin recipients: validate, dedupe. */
export function parseAdminRecipients(raw: string | undefined | null): AdminRecipientConfig {
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const part of (raw ?? '').split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (!e || !EMAIL_RE.test(e) || seen.has(e)) continue;
    seen.add(e);
    recipients.push(e);
  }
  return { recipients, state: recipients.length > 0 ? 'READY' : 'MISSING_CONFIG' };
}

/** Mask an email for display/logging — never expose the full address. */
export function maskAdminEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '*****';
  const head = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${head}***@${domain}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface AdminOrderEmailItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceUgx: number;
  lineTotalUgx: number;
}

export interface AdminOrderEmailInput {
  event: AdminOrderEmailEvent;
  orderNumber: string;
  createdAt: Date;
  preparationState: AdminPreparationState;
  paymentMethod: string | null;
  paymentStatus: string;
  stockConfirmed: boolean;
  totalUgx: number;
  deliveryFeeUgx: number;
  customerDisplayName: string;
  customerContactMasked: string;
  deliverySummary: string;
  deliveryNotes?: string | null;
  items: AdminOrderEmailItem[];
  adminOrderLink: string;
  warnings?: string[];
}

export interface RenderedAdminOrderEmail {
  subject: string;
  text: string;
  html: string;
}

const EVENT_LABEL: Record<AdminOrderEmailEvent, string> = {
  placed: 'New order placed',
  'payment-confirmed': 'Payment confirmed',
  cancelled: 'Order cancelled',
};

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-UG')}`;

/** Render one email (plain text + HTML) for the whole order. All input escaped. */
export function renderAdminOrderEmail(input: AdminOrderEmailInput): RenderedAdminOrderEmail {
  const label = EVENT_LABEL[input.event];
  const subject = `[GoldPlus] ${label} — ${input.orderNumber} (${input.preparationState.replace(/_/g, ' ')})`;

  const itemLinesText = input.items
    .map((i) => `  - ${i.name} [${i.sku}] x${i.quantity} @ ${ugx(i.unitPriceUgx)} = ${ugx(i.lineTotalUgx)}`)
    .join('\n');

  const warnText = (input.warnings ?? []).length
    ? `\nWarnings:\n${(input.warnings ?? []).map((w) => `  ! ${w}`).join('\n')}\n`
    : '';

  const text = [
    `${label} — ${input.orderNumber}`,
    `Placed: ${input.createdAt.toISOString()}`,
    `Preparation state: ${input.preparationState}`,
    `Payment: ${input.paymentStatus}${input.paymentMethod ? ` (${input.paymentMethod})` : ''}`,
    `Stock confirmed: ${input.stockConfirmed ? 'yes' : 'NO — do not prepare'}`,
    `Customer: ${input.customerDisplayName} · ${input.customerContactMasked}`,
    `Delivery: ${input.deliverySummary}`,
    input.deliveryNotes ? `Delivery notes: ${input.deliveryNotes}` : '',
    '',
    'Products:',
    itemLinesText,
    '',
    `Delivery fee: ${ugx(input.deliveryFeeUgx)}`,
    `Order total: ${ugx(input.totalUgx)}`,
    warnText,
    `Open in admin: ${input.adminOrderLink}`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const rows = input.items
    .map(
      (i) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(i.name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace">${escapeHtml(i.sku)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(i.quantity)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(ugx(i.unitPriceUgx))}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(ugx(i.lineTotalUgx))}</td>
      </tr>`
    )
    .join('');

  const warnHtml = (input.warnings ?? []).length
    ? `<ul style="color:#b45309;font-size:13px">${(input.warnings ?? [])
        .map((w) => `<li>${escapeHtml(w)}</li>`)
        .join('')}</ul>`
    : '';

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111">
  <h2 style="margin:0 0 4px">${escapeHtml(label)} — ${escapeHtml(input.orderNumber)}</h2>
  <p style="margin:0 0 12px;font-weight:bold">Preparation state: ${escapeHtml(input.preparationState)}</p>
  <table style="font-size:13px;margin-bottom:12px">
    <tr><td style="padding:2px 8px;color:#555">Placed</td><td>${escapeHtml(input.createdAt.toISOString())}</td></tr>
    <tr><td style="padding:2px 8px;color:#555">Payment</td><td>${escapeHtml(input.paymentStatus)}${input.paymentMethod ? ` (${escapeHtml(input.paymentMethod)})` : ''}</td></tr>
    <tr><td style="padding:2px 8px;color:#555">Stock confirmed</td><td>${input.stockConfirmed ? 'yes' : '<strong style="color:#b91c1c">NO — do not prepare</strong>'}</td></tr>
    <tr><td style="padding:2px 8px;color:#555">Customer</td><td>${escapeHtml(input.customerDisplayName)} · ${escapeHtml(input.customerContactMasked)}</td></tr>
    <tr><td style="padding:2px 8px;color:#555">Delivery</td><td>${escapeHtml(input.deliverySummary)}</td></tr>
    ${input.deliveryNotes ? `<tr><td style="padding:2px 8px;color:#555">Delivery notes</td><td>${escapeHtml(input.deliveryNotes)}</td></tr>` : ''}
  </table>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:12px">
    <thead><tr style="background:#f9fafb;color:#666">
      <th style="text-align:left;padding:6px 10px">Product</th><th style="text-align:left;padding:6px 10px">SKU</th>
      <th style="text-align:right;padding:6px 10px">Qty</th><th style="text-align:right;padding:6px 10px">Unit</th><th style="text-align:right;padding:6px 10px">Line</th>
    </tr></thead><tbody>${rows}</tbody>
  </table>
  ${warnHtml}
  <p style="font-size:13px">Delivery fee: ${escapeHtml(ugx(input.deliveryFeeUgx))} · <strong>Order total: ${escapeHtml(ugx(input.totalUgx))}</strong></p>
  <p><a href="${escapeHtml(input.adminOrderLink)}" style="display:inline-block;background:#f59e0b;color:#111;font-weight:bold;padding:10px 18px;border-radius:8px;text-decoration:none">Open order in admin</a></p>
  </body></html>`;

  return { subject, text, html };
}
