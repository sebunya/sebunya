/**
 * Meta WhatsApp Cloud API: the ONE place its environment is read (owner, 2026-10-14: WhatsApp goes to Meta
 * directly; Zoho CPaaS is the fallback). The same number and token Goldie and the Care Desk alerts use.
 *
 *   GOLDIE_WHATSAPP_PHONE_NUMBER_ID  the Cloud API phone number id that sends
 *   WHATSAPP_WABA_ID                 optional: the WhatsApp Business Account id; normally the one saved with the
 *                                    WhatsApp settings in the admin (Advertising > Offline sales) is used
 *   WHATSAPP_MESSAGING_ACCOUNT_ID    the Messaging account id (Meta: templates and billing live there); template
 *                                    calls try it first, then the WhatsApp account id
 *   GOLDIE_WHATSAPP_TOKEN            a system-user token (whatsapp_business_messaging + _management); when
 *                                    unset, the token saved with the WhatsApp settings in the admin is used
 *
 * Pure: an env snapshot in, a value out. The token never appears in `problems`.
 */
export interface MetaWhatsAppConfig {
  phoneNumberId: string | null;
  wabaId: string | null;
  messagingAccountId: string | null;
  envToken: string | null;
  /** The sending number id is present (the account id and token may come from the admin's saved settings). */
  configured: boolean;
  problems: string[];
}

export function readMetaWhatsAppConfig(env: NodeJS.ProcessEnv = process.env): MetaWhatsAppConfig {
  const phone = (env.GOLDIE_WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const waba = (env.WHATSAPP_WABA_ID || '').trim();
  const token = (env.GOLDIE_WHATSAPP_TOKEN || '').trim();
  const problems: string[] = [];
  if (!phone) problems.push('GOLDIE_WHATSAPP_PHONE_NUMBER_ID is not set.');
  else if (!/^\d{5,20}$/.test(phone)) problems.push('GOLDIE_WHATSAPP_PHONE_NUMBER_ID must be digits (the Cloud API phone number id).');
  if (waba && !/^\d{5,20}$/.test(waba)) problems.push('WHATSAPP_WABA_ID must be digits (the WhatsApp Business Account id).');
  const msg = (env.WHATSAPP_MESSAGING_ACCOUNT_ID || '').trim();
  return { messagingAccountId: /^\d{5,20}$/.test(msg) ? msg : null, phoneNumberId: /^\d{5,20}$/.test(phone) ? phone : null, wabaId: /^\d{5,20}$/.test(waba) ? waba : null, envToken: token || null, configured: problems.length === 0, problems };
}
