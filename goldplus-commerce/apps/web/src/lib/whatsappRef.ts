/**
 * WhatsApp click-to-chat reference (attribution module, migration 0156). Pure,
 * so it is unit-tested without a browser; lib/telemetry wires it to clicks.
 *
 * Same alphabet as WHATSAPP_REF_ALPHABET in @goldplus/shared — kept as its own
 * constant so the storefront bundle does not pull in the shared package index
 * (tests/unit/ChannelAttribution.test.ts holds the two together).
 */
export const WA_REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const WA_REF_IN_TEXT = /\bRef (GP-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6})\b/;

export function newWhatsAppRef(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let out = '';
  while (out.length < 6) {
    for (const b of random(12)) {
      // 240 = 8 × 30: rejecting the top of the byte range keeps every character equally likely.
      if (b < 240 && out.length < 6) out += WA_REF_ALPHABET[b % 30];
    }
  }
  return `GP-${out}`;
}

/**
 * The href with a visible "Ref GP-XXXXXX" line added to the prefilled message,
 * or null when the link is not a chat with a number (a share link, wa.me/?text=,
 * goes to anyone and is left alone). A link that already carries a reference
 * keeps it (a second tap is the same chat).
 */
export function tagWhatsAppHref(href: string, code: string): { href: string; code: string; fresh: boolean } | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const toNumber = (url.hostname === 'wa.me' && /^\/\d{6,15}\/?$/.test(url.pathname))
    || (url.hostname === 'api.whatsapp.com' && /^\d{6,15}$/.test(url.searchParams.get('phone') ?? ''));
  if (!toNumber) return null;
  const text = url.searchParams.get('text') ?? '';
  const existing = WA_REF_IN_TEXT.exec(text);
  if (existing) return { href, code: existing[1], fresh: false };
  const next = `${text}${text ? '\n\n' : ''}Ref ${code}`;
  // Percent-encoded, not URLSearchParams' "+" for a space: WhatsApp's documented form.
  const params = [...url.searchParams.entries()].filter(([k]) => k !== 'text').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  params.push(`text=${encodeURIComponent(next)}`);
  url.search = `?${params.join('&')}`;
  return { href: url.toString(), code, fresh: true };
}
