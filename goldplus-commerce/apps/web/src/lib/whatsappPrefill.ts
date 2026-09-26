/**
 * One WhatsApp deep link with the message encoded ONCE.
 *
 * The prefill may arrive as a message ("Hi GoldPlus, I need a battery…") or,
 * from an older admin value, as a complete wa.me URL. Wrapping a URL in
 * another URL sent customers a message that BEGAN with a link (found on the
 * live Power menu, 2026-09-26). The recipient is always `base` — the one
 * number the admin controls — never a number inside the prefill.
 */
export function whatsappHref(base: string, prefill?: string | null): string {
  const message = whatsappMessageFrom(prefill);
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** The human-readable message inside a prefill, whichever shape it has. */
export function whatsappMessageFrom(prefill?: string | null): string {
  const raw = (prefill ?? '').trim();
  if (!raw) return '';
  if (!/^https?:\/\/(wa\.me|api\.whatsapp\.com)\b/i.test(raw)) return raw;
  try {
    const text = new URL(raw).searchParams.get('text') ?? '';
    // A value that was encoded twice still decodes to a URL: unwrap again.
    return /^https?:\/\//i.test(text) ? whatsappMessageFrom(text) : text.trim();
  } catch {
    return '';
  }
}
