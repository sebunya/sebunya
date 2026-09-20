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
