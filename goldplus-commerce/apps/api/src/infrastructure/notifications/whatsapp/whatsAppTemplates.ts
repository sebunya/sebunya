import {
  formatUgx,
  supportPhoneDisplay,
  trackOrderUrl,
} from '../../../application/notifications/CustomerMessages';
import { tagShopUrl } from '@goldplus/shared';

/**
 * The ONE list of GoldPlus WhatsApp templates, sent directly through Meta's WhatsApp Cloud API (owner,
 * 2026-10-14: "we need to talk to Meta directly for WhatsApp"; Zoho CPaaS is no longer used for WhatsApp).
 *
 * A template that is not here is never sent on WhatsApp. One that is here is sent only once Meta has
 * APPROVED it (MetaWhatsAppTemplateCatalog reads the approval status from Meta); until then the customer gets
 * the SMS. Admin > Notifications > WhatsApp templates submits any that are missing, word for word from here.
 *
 * Utility templates use Meta's NAMED parameters: `body` is the text submitted for approval, its {{variables}}
 * are exactly `variables`, in order (a unit test holds them together). Meta refuses a body that starts or ends
 * with a variable, and a variable followed only by punctuation counts as the end ("Call {{support_phone}}." was
 * rejected on 2026-10-14), so every body ends in words. The phone code is an AUTHENTICATION template, whose wording
 * Meta fixes itself (code, security line, expiry footer, copy-code button).
 *
 * Wording follows the SMS in CustomerMessages: the two channels must never disagree.
 */

export type WhatsAppTemplateCategory = 'UTILITY' | 'AUTHENTICATION';

export interface WhatsAppVariable {
  name: string;
  /** Sample value Meta's reviewers see when the template is submitted. */
  example: string;
  /** Null means "we do not have this value": the message is not sent on WhatsApp. */
  value: (d: Record<string, unknown>) => string | null;
}

export interface WhatsAppTemplateSpec {
  /** The template's name at Meta (lower case, underscores). */
  name: string;
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

const V: Record<string, WhatsAppVariable> = {
  customerName: { name: 'customer_name', example: 'Sarah', value: firstNameOr('there') },
  orderNumber: { name: 'order_number', example: 'GP-10427', value: (d) => str(d.orderNumber) },
  amount: {
    name: 'amount',
    example: 'UGX 145,000',
    value: (d) => (Number.isFinite(Number(d.totalUgx)) && Number(d.totalUgx) > 0 ? formatUgx(Number(d.totalUgx)) : null),
  },
  trackUrl: { name: 'track_url', example: 'https://shopgoldplus.com/track-order?reference=GP-10427', value: (d) => (str(d.orderNumber) ? tagShopUrl(trackOrderUrl(str(d.orderNumber)!), 'w') : null) },
  supportPhone: { name: 'support_phone', example: '0705 004545', value: () => supportPhoneDisplay() },
  reference: { name: 'reference', example: 'SR-2041', value: (d) => str(d.reference) },
  code: { name: 'code', example: '482913', value: (d) => str(d.code) },
};

export const WHATSAPP_TEMPLATES: Readonly<Record<string, WhatsAppTemplateSpec>> = Object.freeze({
  ORDER_RECEIVED_UNPAID: {
    name: 'goldplus_order_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, we have your GoldPlus order {{order_number}} for {{amount}}. It is not paid yet. Our team will call you to confirm it. If you have questions, call us on {{support_phone}} and we will help.',
    variables: [V.customerName, V.orderNumber, V.amount, V.supportPhone],
  },
  ORDER_PAYMENT_PENDING: {
    name: 'goldplus_payment_pending',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, your payment for GoldPlus order {{order_number}} has started but has not cleared yet. Please do not pay again. We will confirm it shortly. Call {{support_phone}} if you are unsure.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  ORDER_PAYMENT_SUCCESS: {
    name: 'goldplus_payment_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, we have your payment of {{amount}} for GoldPlus order {{order_number}}. Your items are being prepared. Track it here: {{track_url}} Thank you for shopping with GoldPlus.',
    variables: [V.customerName, V.amount, V.orderNumber, V.trackUrl],
  },
  ORDER_PAYMENT_FAILED: {
    name: 'goldplus_payment_failed',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, the payment for GoldPlus order {{order_number}} did not go through, so it is not paid. If money left your phone, it will come back. To pay again or get help, call {{support_phone}} and we will sort it out.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  ORDER_PAYMENT_CANCELLED: {
    name: 'goldplus_payment_cancelled',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, you cancelled the payment for GoldPlus order {{order_number}}. Nothing was charged and the order is saved. Pay when you are ready, or call {{support_phone}} for help.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  ORDER_FULFILLMENT_PROCESSING: {
    name: 'goldplus_order_packing',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, your GoldPlus order {{order_number}} is being packed at our shop. We will message you when the rider leaves. Track it here: {{track_url}} Thank you.',
    variables: [V.customerName, V.orderNumber, V.trackUrl],
  },
  ORDER_DISPATCHED: {
    name: 'goldplus_order_on_the_way',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, your GoldPlus order {{order_number}} is on its way with our rider. Please keep your phone on. Track it here: {{track_url}} Thank you.',
    variables: [V.customerName, V.orderNumber, V.trackUrl],
  },
  ORDER_FULFILLMENT_COMPLETED: {
    name: 'goldplus_order_delivered',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, your GoldPlus order {{order_number}} has been delivered. Thank you. If anything is wrong with it, call {{support_phone}} and we will sort it out.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  ORDER_CANCELLED_BY_SHOP: {
    name: 'goldplus_order_cancelled',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, GoldPlus order {{order_number}} has been cancelled. If you paid for it, our team arranges the refund. Call {{support_phone}} if you have not heard from us.',
    variables: [V.customerName, V.orderNumber, V.supportPhone],
  },
  PHONE_VERIFICATION: {
    name: 'goldplus_phone_code',
    category: 'AUTHENTICATION',
    // Meta writes authentication wording itself; this is what the customer sees (expiry fixed at 10 minutes).
    body: '{{code}} is your verification code. For your security, do not share this code. This code expires in 10 minutes.',
    variables: [V.code],
  },
  SUPPORT_REQUEST_RECEIVED: {
    name: 'goldplus_support_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, GoldPlus has your request (ref {{reference}}). Our team will call you on this number. Need us sooner? Call {{support_phone}} anytime.',
    variables: [V.customerName, V.reference, V.supportPhone],
  },
  QUOTE_REQUEST_RECEIVED: {
    name: 'goldplus_quote_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, GoldPlus has your quote request (ref {{reference}}). Our sales team will call you to confirm what you need and give you a price. Call {{support_phone}} anytime.',
    variables: [V.customerName, V.reference, V.supportPhone],
  },
  DEALER_APPLICATION_RECEIVED: {
    name: 'goldplus_dealer_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, GoldPlus has your dealer application (ref {{reference}}). Our team will review it and call you. Questions? Call {{support_phone}} anytime.',
    variables: [V.customerName, V.reference, V.supportPhone],
  },
  FAKE_REPORT_RECEIVED: {
    name: 'goldplus_fake_report_received',
    category: 'UTILITY',
    body: 'Hello {{customer_name}}, thank you for reporting a suspected fake to GoldPlus (ref {{reference}}). We check every report. We may call you for a detail or two. Questions? Call {{support_phone}} anytime.',
    variables: [V.customerName, V.reference, V.supportPhone],
  },
});

export function whatsAppTemplateSpec(template: string): WhatsAppTemplateSpec | null {
  return WHATSAPP_TEMPLATES[(template || '').trim().toUpperCase()] ?? null;
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

/** The staff alert (Care Desk): positional {{1}} = the alert line, sent to the team's own numbers. */
export const CARE_ALERT_TEMPLATE = Object.freeze({
  name: 'goldplus_care_alert',
  category: 'UTILITY' as const,
  body: 'A GoldPlus customer needs a person now: {{1}} Please open the Care Desk at shopgoldplus.com/admin/care.',
  example: 'GoldPlus Care: Urgent. Order never arrived (GP-10427). Customer: Sarah 0772 123456. Open the Care Desk.',
});

export const WHATSAPP_TEMPLATE_LANGUAGE = 'en';

/** The request body that creates a template at Meta (POST /{waba-id}/message_templates). */
export function metaTemplateCreateBody(spec: WhatsAppTemplateSpec): Record<string, unknown> {
  if (spec.category === 'AUTHENTICATION') {
    return {
      name: spec.name, language: WHATSAPP_TEMPLATE_LANGUAGE, category: 'AUTHENTICATION',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 10 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
      ],
    };
  }
  return {
    name: spec.name, language: WHATSAPP_TEMPLATE_LANGUAGE, category: spec.category, parameter_format: 'NAMED',
    components: [{ type: 'BODY', text: spec.body, example: { body_text_named_params: spec.variables.map((v) => ({ param_name: v.name, example: v.example })) } }],
  };
}

export function careAlertCreateBody(): Record<string, unknown> {
  return {
    name: CARE_ALERT_TEMPLATE.name, language: WHATSAPP_TEMPLATE_LANGUAGE, category: CARE_ALERT_TEMPLATE.category,
    components: [{ type: 'BODY', text: CARE_ALERT_TEMPLATE.body, example: { body_text: [[CARE_ALERT_TEMPLATE.example]] } }],
  };
}

/** The `template` object of a send (POST /{phone-number-id}/messages) for filled values. */
export function metaTemplateSendObject(spec: WhatsAppTemplateSpec, values: Array<{ name: string; value: string }>): Record<string, unknown> {
  const tidy = (t: string) => t.replace(/\s+/g, ' ').trim();
  if (spec.category === 'AUTHENTICATION') {
    const code = tidy(values.find((v) => v.name === 'code')?.value ?? '');
    return {
      name: spec.name, language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    };
  }
  return {
    name: spec.name, language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
    components: [{ type: 'body', parameters: values.map((v) => ({ type: 'text', parameter_name: v.name, text: tidy(v.value) })) }],
  };
}
