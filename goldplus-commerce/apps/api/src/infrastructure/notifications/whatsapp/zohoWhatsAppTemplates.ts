import {
  formatUgx,
  supportPhoneDisplay,
  trackOrderUrl,
} from '../../../application/notifications/CustomerMessages';

/**
 * The ONE map from our templates to WhatsApp templates in Zoho CPaaS.
 *
 * A template that is not in this map is never sent on WhatsApp. A template that
 * is in it is sent only once the owner has created the matching template in
 * Zoho CPaaS, Meta has approved it, and its system-generated template key is in
 * ZOHO_WHATSAPP_TEMPLATE_<OUR_TEMPLATE>.
 *
 * `body` is the text proposed for Meta approval, word for word. Its {{variables}}
 * are exactly `variables`, in order — a unit test holds the two together, so the
 * text the owner submits and the values we send cannot drift apart.
 *
 * Wording follows the SMS in CustomerMessages (the two channels must never
 * disagree), minus the "reply to this message" prompt: Zoho CPaaS does not
 * handle inbound WhatsApp replies yet, so promising one would be untrue.
 */

export type WhatsAppTemplateCategory = 'UTILITY' | 'AUTHENTICATION';

export interface WhatsAppVariable {
  name: string;
  /** Null means "we do not have this value": the message is not sent on WhatsApp. */
  value: (d: Record<string, unknown>) => string | null;
}

export interface WhatsAppTemplateSpec {
  /** Name to give the template in Zoho CPaaS (lower case, underscores). */
  zohoName: string;
  category: WhatsAppTemplateCategory;
  body: string;
  variables: WhatsAppVariable[];
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  return s ? s : null;
};

const firstNameOr = (fallback: string) => (d: Record<string, unknown>): string => {
  const n = str(d.customerName);
  return n ? n.split(/\s+/)[0] : fallback;
};

const V = {
  customerName: { name: 'customer_name', value: firstNameOr('there') } as WhatsAppVariable,
  orderNumber: { name: 'order_number', value: (d) => str(d.orderNumber) } as WhatsAppVariable,
  amount: {
    name: 'amount',
    value: (d) => (Number.isFinite(Number(d.totalUgx)) && Number(d.totalUgx) > 0 ? formatUgx(Number(d.totalUgx)) : null),
  } as WhatsAppVariable,
  trackUrl: { name: 'track_url', value: (d) => (str(d.orderNumber) ? trackOrderUrl(str(d.orderNumber)) : null) } as WhatsAppVariable,
  supportPhone: { name: 'support_phone', value: () => supportPhoneDisplay() } as WhatsAppVariable,
  reference: { name: 'reference', value: (d) => str(d.reference) } as WhatsAppVariable,
  code: { name: 'code', value: (d) => str(d.code) } as WhatsAppVariable,
  minutes: { name: 'minutes', value: (d) => str(d.expiresInMinutes) ?? '10' } as WhatsAppVariable,
};

export const ZOHO_WHATSAPP_TEMPLATES: Readonly<Record<string, WhatsAppTemplateSpec>> = Object.freeze({
  ORDER_RECEIVED_UNPAID: {
    zohoName: 'goldplus_order_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, we have your GoldPlus order {{order_number}} for {{amount}}. It is not paid yet. Our team will call you to confirm it. Questions? Call {{support_phone}}.',
    variables: [V.customerName, V.orderNumber, V.amount, V.supportPhone],
  },
  ORDER_PAYMENT_PENDING: {
    zohoName: 'goldplus_payment_pending',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, your payment for GoldPlus order {{order_number}} has started but has not cleared yet. Please do not pay again. We will confirm it shortly. Call {{support_phone}} if you are unsure.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  ORDER_PAYMENT_SUCCESS: {
    zohoName: 'goldplus_payment_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, we have your payment of {{amount}} for GoldPlus order {{order_number}}. Your items are being prepared. Track it: {{track_url}}',
    variables: [V.customerName, V.amount, V.orderNumber, V.trackUrl],
  },
  ORDER_PAYMENT_FAILED: {
    zohoName: 'goldplus_payment_failed',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, the payment for GoldPlus order {{order_number}} did not go through, so it is not paid. If money left your phone, it will come back. To pay again or get help, call {{support_phone}}.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  ORDER_PAYMENT_CANCELLED: {
    zohoName: 'goldplus_payment_cancelled',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, you cancelled the payment for GoldPlus order {{order_number}}. Nothing was charged and the order is saved. Pay when you are ready, or call {{support_phone}}.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  ORDER_FULFILLMENT_PROCESSING: {
    zohoName: 'goldplus_order_packing',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, your GoldPlus order {{order_number}} is being packed at our shop. We will message you when the rider leaves. Track it: {{track_url}}',
    variables: [V.customerName, V.orderNumber, V.trackUrl],
  },
  ORDER_DISPATCHED: {
    zohoName: 'goldplus_order_on_the_way',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, your GoldPlus order {{order_number}} is on its way with our rider. Please keep your phone on. Track it: {{track_url}}',
    variables: [V.customerName, V.orderNumber, V.trackUrl],
  },
  ORDER_FULFILLMENT_COMPLETED: {
    zohoName: 'goldplus_order_delivered',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, your GoldPlus order {{order_number}} has been delivered. Thank you. If anything is wrong with it, call {{support_phone}} and we will sort it out.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  ORDER_CANCELLED_BY_SHOP: {
    zohoName: 'goldplus_order_cancelled',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, GoldPlus order {{order_number}} has been cancelled. If you paid for it, our team arranges the refund. Call {{support_phone}} if you have not heard from us.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  PHONE_VERIFICATION: {
    zohoName: 'goldplus_phone_code',
    category: 'AUTHENTICATION',
    body: 'Your GoldPlus code is {{code}}. It expires in {{minutes}} minutes. Never share this code with anyone, including us.',
    variables: [V.code, V.minutes],
  },
  SUPPORT_REQUEST_RECEIVED: {
    zohoName: 'goldplus_support_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, GoldPlus has your request (ref {{reference}}). Our team will call you on this number. Need us sooner? Call {{support_phone}}.',
    variables: [V.customerName, V.reference, V.supportPhone],
  },
  QUOTE_REQUEST_RECEIVED: {
    zohoName: 'goldplus_quote_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, GoldPlus has your quote request (ref {{reference}}). Our sales team will call you to confirm what you need and give you a price. Call {{support_phone}} anytime.',
    variables: [V.customerName, V.reference, V.supportPhone],
  },
  DEALER_APPLICATION_RECEIVED: {
    zohoName: 'goldplus_dealer_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, GoldPlus has your dealer application (ref {{reference}}). Our team will review it and call you. Questions? Call {{support_phone}}.',
    variables: [V.customerName, V.reference, V.supportPhone],
  },
  FAKE_REPORT_RECEIVED: {
    zohoName: 'goldplus_fake_report_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, thank you for reporting a suspected fake to GoldPlus (ref {{reference}}). We check every report. We may call you for a detail or two. Questions? Call {{support_phone}}.',
    variables: [V.customerName, V.reference, V.supportPhone],
  },
});

export function whatsAppTemplateSpec(template: string): WhatsAppTemplateSpec | null {
  return ZOHO_WHATSAPP_TEMPLATES[(template || '').trim().toUpperCase()] ?? null;
}

/**
 * The template's variables filled from the event data, in template order, or
 * the names of the ones we could not fill. A message with a hole in it is never
 * sent: WhatsApp would reject it, or worse, deliver it with a blank.
 */
export function fillWhatsAppVariables(
  spec: WhatsAppTemplateSpec,
  data: Record<string, unknown>,
): { ok: true; values: Array<{ name: string; value: string }> } | { ok: false; missing: string[] } {
  const values: Array<{ name: string; value: string }> = [];
  const missing: string[] = [];
  for (const v of spec.variables) {
    const value = v.value(data);
    if (value === null || value === '') missing.push(v.name);
    else values.push({ name: v.name, value });
  }
  return missing.length ? { ok: false, missing } : { ok: true, values };
}
