/**
 * Pure rules for the lead signals (advertising 0154), kept free of browser
 * globals so they are unit-tested directly.
 */

/**
 * A chat WITH US: wa.me/<number> or api.whatsapp.com/send?phone=<number>, the
 * number in international digits without "+" (WhatsApp's documented click-to-
 * chat form). A share link (wa.me/?text=) is not. The SAME rule as
 * tagWhatsAppHref (lib/whatsappRef), so every tap counted as a lead is also a
 * tap that gets a reference code.
 */
export function isWhatsAppChatWithUs(href: string): boolean {
  let url: URL;
  try { url = new URL(href); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  return (url.hostname === 'wa.me' && /^\/\d{6,15}\/?$/.test(url.pathname))
    || (url.hostname === 'api.whatsapp.com' && /^\/send\/?$/.test(url.pathname) && /^\d{6,15}$/.test(url.searchParams.get('phone') ?? ''));
}

/** True when this reference's lead was already sent from this device; marks it sent otherwise. */
export function leadAlreadySent(ref: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  if (!storage) return false;
  const key = `_gp_lead_${ref}`;
  try {
    if (storage.getItem(key) === '1') return true;
    storage.setItem(key, '1');
  } catch { /* storage full or blocked: send once for this page view */ }
  return false;
}
