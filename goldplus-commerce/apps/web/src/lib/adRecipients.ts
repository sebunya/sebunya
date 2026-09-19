import { apiBase } from './api';

/**
 * The advertising platforms currently RECEIVING conversion data (names only),
 * read live. null when it could not be read: the page must then say nothing
 * rather than claim "none" while a platform may be live.
 */
export async function fetchAdRecipients(): Promise<string[] | null> {
  try {
    const r = await fetch(`${apiBase}/advertising/recipients`, { headers: { Accept: 'application/json' } });
    const j = r.ok ? await r.json() : null;
    return Array.isArray(j?.data) ? j.data.map(String) : null;
  } catch {
    return null;
  }
}
