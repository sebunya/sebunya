import { apiBase } from './api';

/**
 * The advertising platforms currently RECEIVING conversion data (names only),
 * read live. null when it could not be read: the page must then say nothing
 * rather than claim "none" while a platform may be live.
 */
export async function fetchAdRecipients(): Promise<string[] | null> {
  try {
    // Bounded: a stalled API must not hang the privacy page; an abort lands in
    // the catch below and the page says nothing, as documented above.
    const r = await fetch(`${apiBase}/advertising/recipients`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    const j = r.ok ? await r.json() : null;
    return Array.isArray(j?.data) ? j.data.map(String) : null;
  } catch {
    return null;
  }
}

/**
 * What else the privacy page must disclose, read live: whether chats begun from
 * a WhatsApp advert are being recorded. null when it could not be read: the
 * page then says "may", never "does not".
 */
export async function fetchAdDisclosures(): Promise<{ whatsappAdverts: boolean } | null> {
  try {
    const r = await fetch(`${apiBase}/advertising/disclosures`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    const j = r.ok ? await r.json() : null;
    return j?.success && typeof j?.data?.whatsappAdverts === 'boolean' ? { whatsappAdverts: j.data.whatsappAdverts } : null;
  } catch {
    return null;
  }
}
