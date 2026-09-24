import { GENERATED_EMAIL_TEMPLATES } from './generatedEmailTemplates';
import { renderTemplate, type TemplateData } from './renderEmailTemplate';

/**
 * Turns what the shop knows about an order into what the templates ask for.
 *
 * The templates were designed and reviewed against a fixed set of names
 * (order_reference, subtotal, items[].line_total …). This is the one place that
 * translation happens, so a rename in the design is a single edit here rather
 * than a hunt through the sending code.
 */
export interface AdminEmailSource {
  orderNumber: string;
  createdAt: Date;
  eventLabel: string;
  preparationState: string;
  preparationInstruction: string;
  paymentStatus: string;
  stockConfirmed: boolean;
  totalUgx: number;
  deliveryFeeUgx: number;
  customerName: string;
  customerContactMasked: string;
  deliveryLocation: string;
  deliveryAddress: string;
  adminUrl: string;
  items: Array<{ sku: string; name: string; quantity: number; unitPriceUgx: number; lineTotalUgx: number }>;
}

const ugx = (n: number) => `UGX ${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;

/** Kampala time, spelled the way the templates show it. */
export const orderDate = (d: Date): string =>
  new Date(d).toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'long', year: 'numeric' });

export function adminEmailData(src: AdminEmailSource): TemplateData {
  const subtotal = src.items.reduce((sum, i) => sum + (Number(i.lineTotalUgx) || 0), 0);
  return {
    year: String(new Date().getFullYear()),
    order_reference: src.orderNumber,
    order_date: orderDate(src.createdAt),
    admin_event_label: src.eventLabel,
    admin_url: src.adminUrl,
    customer_name: src.customerName,
    customer_phone: src.customerContactMasked,
    delivery_location: src.deliveryLocation,
    delivery_address: src.deliveryAddress || src.deliveryLocation,
    payment_status: src.paymentStatus,
    preparation_state: src.preparationState,
    preparation_instruction: src.preparationInstruction,
    stock_status: src.stockConfirmed ? 'Stock confirmed' : 'Stock NOT confirmed',
    items: src.items.map((i) => ({
      name: i.name,
      sku: i.sku,
      quantity: i.quantity,
      unit_price: ugx(i.unitPriceUgx),
      line_total: ugx(i.lineTotalUgx),
    })),
    subtotal: ugx(subtotal),
    delivery_fee: ugx(src.deliveryFeeUgx),
    total: ugx(subtotal + (Number(src.deliveryFeeUgx) || 0)),
    // A delivery fee agreed with the customer is a confirmed total; a zero fee
    // on an order that still needs one is not, and the template says so instead
    // of quoting a number nobody has agreed.
    total_confirmed: Number(src.deliveryFeeUgx) > 0,
  };
}

export interface RenderedEmail { subject: string; html: string; text: string }

/** Renders one template, or throws naming what was missing. */
export function renderEmailTemplate(key: string, data: TemplateData): RenderedEmail {
  const template = GENERATED_EMAIL_TEMPLATES[key];
  if (!template) throw new Error(`EMAIL_TEMPLATE_UNKNOWN: ${key}`);
  return {
    subject: renderTemplate(template.subject, data, { escape: false }),
    html: renderTemplate(template.html, data),
    text: renderTemplate(template.text, data, { escape: false }),
  };
}

export const hasEmailTemplate = (key: string): boolean => key in GENERATED_EMAIL_TEMPLATES;

/** What the shop knows about an order when it messages the customer about it. */
export interface CustomerEmailSource {
  customerName?: string | null;
  orderNumber?: string | null;
  createdAt?: Date | string | null;
  totalUgx?: number | null;
  deliveryFeeUgx?: number | null;
  deliveryLocation?: string | null;
  paymentStatus?: string | null;
  orderUrl?: string | null;
  items?: Array<{ name: string; quantity: number; unitPriceUgx: number; lineTotalUgx: number }>;
  /** Payment receipt extras. */
  amountReceivedUgx?: number | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paymentDate?: Date | string | null;
  /** Account recovery. */
  resetUrl?: string | null;
  resetExpiryMinutes?: number | null;
  /** Why an order was cancelled, in the shop's own words. */
  cancellationReason?: string | null;
  refundUpdate?: string | null;
}

function receiptTotal(grossUgx: number, chargedUgx: number | null | undefined): string {
  const charged = Number(chargedUgx);
  if (!Number.isFinite(charged) || charged <= 0) return ugx(grossUgx);
  const reductions = grossUgx - charged;
  return reductions > 0 ? `${ugx(charged)} (after ${ugx(reductions)} in points and discounts)` : ugx(charged);
}

const firstName = (full?: string | null) => String(full ?? '').trim().split(/\s+/)[0] || 'there';
const asDate = (v: Date | string | null | undefined) => (v ? new Date(v) : new Date());

/**
 * Builds the variables for a CUSTOMER template. Only the keys a given template
 * uses need to be present; the renderer throws if one it needs is missing,
 * which is how a half-filled email is caught before it is sent rather than
 * after a customer reads it.
 */
export function customerEmailData(template: string, src: CustomerEmailSource): TemplateData {
  const items = (src.items ?? []).map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unit_price: ugx(i.unitPriceUgx),
    line_total: ugx(i.lineTotalUgx),
  }));
  const subtotal = (src.items ?? []).reduce((sum, i) => sum + (Number(i.lineTotalUgx) || 0), 0);
  const deliveryFee = Number(src.deliveryFeeUgx) || 0;
  const data: TemplateData = {
    year: String(new Date().getFullYear()),
    first_name: firstName(src.customerName),
  };

  // Every order template shares this block.
  if (template.startsWith('ORDER_')) {
    Object.assign(data, {
      order_reference: src.orderNumber ?? '',
      order_date: orderDate(asDate(src.createdAt)),
      order_url: src.orderUrl ?? 'https://shopgoldplus.com/orders',
      delivery_location: src.deliveryLocation ?? 'your delivery address',
      payment_status: src.paymentStatus === 'paid' ? 'Paid' : src.paymentStatus === 'failed' ? 'Not paid' : 'Awaiting payment',
      items,
      subtotal: ugx(subtotal),
      delivery_fee: deliveryFee > 0 ? ugx(deliveryFee) : 'To be confirmed',
      // The order's OWN total, which is what was charged. Items + delivery
      // ignored points redeemed and order-level offers, so the receipt read
      // "Order total 190,000 / Payment received 170,000" — an apparent
      // underpayment. The template has no discount row, so the reduction is
      // named beside the total instead of left unexplained.
      total: receiptTotal(subtotal + deliveryFee, src.totalUgx),
      // A delivery fee nobody has agreed yet is not part of a settled total,
      // and the template shows the subtotal alone rather than a figure the
      // customer never accepted.
      total_confirmed: deliveryFee > 0,
    });
  }

  if (template === 'ORDER_PAYMENT_SUCCESS') {
    Object.assign(data, {
      amount_received: ugx(Number(src.amountReceivedUgx ?? src.totalUgx) || 0),
      payment_method: src.paymentMethod ?? 'Mobile money',
      payment_reference: src.paymentReference ?? src.orderNumber ?? '',
      payment_date: asDate(src.paymentDate).toLocaleString('en-GB', {
        timeZone: 'Africa/Kampala', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      }) + ' EAT',
    });
  }

  if (template === 'ORDER_CANCELLED_BY_SHOP') {
    Object.assign(data, {
      cancellation_reason: src.cancellationReason ?? 'We could not complete this order.',
      refund_update: src.refundUpdate ?? 'If any money was taken, we will return it and tell you when it is done.',
    });
  }

  if (template === 'PASSWORD_RESET') {
    Object.assign(data, {
      reset_url: src.resetUrl ?? '',
      reset_expiry_minutes: String(src.resetExpiryMinutes ?? 30),
    });
  }

  return data;
}
