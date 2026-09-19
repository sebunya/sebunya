import { apiBase } from './api';

/**
 * The advertising platforms currently RECEIVING conversion data (names only),
 * read live so the privacy page never says "none" while one is switched on or
 * names one that is off. Empty on any failure.
 */
export async function fetchAdRecipients(): Promise<string[]> {
  try {
    const r = await fetch(`${apiBase}/advertising/recipients`, { headers: { Accept: 'application/json' } });
    const j = r.ok ? await r.json() : null;
    return Array.isArray(j?.data) ? j.data.map(String) : [];
  } catch {
    return [];
  }
}
