/**
 * Meta's own verdict on the events it receives (2026-10-01). Pure.
 *
 * "Live" on the Advertising page says the shop is sending. It cannot say
 * whether Meta can USE what arrives. Meta publishes that itself, per event,
 * through the Dataset Quality API: an Event Match Quality score out of 10 and,
 * for each match key, the share of events that carried it. This module reads
 * that answer and words it; it computes no score of its own.
 */

export interface MetaMatchKeyCoverage { identifier: string; label: string; percentage: number | null }
export interface MetaEventQuality { event: string; score: number | null; band: 'none' | 'low' | 'fair' | 'good' | 'high'; keys: MetaMatchKeyCoverage[] }

/** Meta's identifier names, as a person would say them. An unknown one is shown as Meta wrote it. */
const KEY_LABEL: Record<string, string> = {
  email: 'Email', phone: 'Phone', fbc: 'Click ID (fbc)', fbp: 'Browser ID (fbp)', external_id: 'Visitor ID', ip_address: 'IP address', user_agent: 'Browser (user agent)',
  first_name: 'First name', last_name: 'Last name', city: 'City', state: 'State', zip: 'Postcode', country: 'Country', date_of_birth: 'Date of birth', gender: 'Gender',
  fb_login_id: 'Facebook login ID', lead_id: 'Lead ID',
};
export const metaKeyLabel = (identifier: string): string => KEY_LABEL[identifier] ?? identifier;

/**
 * A band for the eye, not a claim about Meta's wording: the number shown
 * beside it is Meta's own and is what should be read.
 */
export function emqBand(score: number | null): MetaEventQuality['band'] {
  if (score == null) return 'none';
  if (score < 4) return 'low';
  if (score < 6) return 'fair';
  if (score < 8) return 'good';
  return 'high';
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The Dataset Quality API's `web` array, reduced to what the page shows.
 * Anything Meta did not send is null — never 0: "no score yet" and "a score
 * of zero" are different answers.
 */
export function parseDatasetQuality(json: unknown): MetaEventQuality[] {
  const web = (json as { web?: unknown } | null)?.web;
  if (!Array.isArray(web)) return [];
  const out: MetaEventQuality[] = [];
  for (const row of web as Array<Record<string, unknown>>) {
    const event = typeof row?.event_name === 'string' ? row.event_name : null;
    if (!event) continue;
    const emq = (row.event_match_quality ?? {}) as { composite_score?: unknown; match_key_feedback?: unknown };
    const raw = num(emq.composite_score);
    const score = raw != null && raw >= 0 && raw <= 10 ? Math.round(raw * 10) / 10 : null;
    const keys: MetaMatchKeyCoverage[] = Array.isArray(emq.match_key_feedback)
      ? (emq.match_key_feedback as Array<Record<string, unknown>>)
        .filter((k) => typeof k?.identifier === 'string')
        .map((k) => {
          const pct = num((k.coverage as { percentage?: unknown } | undefined)?.percentage);
          return { identifier: String(k.identifier), label: metaKeyLabel(String(k.identifier)), percentage: pct != null && pct >= 0 && pct <= 100 ? Math.round(pct * 10) / 10 : null };
        })
        .sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1))
      : [];
    out.push({ event, score, band: emqBand(score), keys });
  }
  // The sale first, then the journey towards it.
  const ORDER = ['Purchase', 'InitiateCheckout', 'AddPaymentInfo', 'AddToCart', 'ViewContent', 'Lead', 'Contact'];
  return out.sort((a, b) => (ORDER.indexOf(a.event) + 1 || 99) - (ORDER.indexOf(b.event) + 1 || 99) || a.event.localeCompare(b.event));
}

/** A test event code as Events Manager issues it (TEST followed by digits/letters). */
export const isMetaTestEventCode = (v: unknown): v is string => typeof v === 'string' && /^TEST[A-Za-z0-9]{1,30}$/.test(v.trim());

/**
 * What each kind of event carries to Meta, by name only — the values are
 * never kept after sending, so this is a statement of the code's behaviour
 * (MetaIdentifiers, AdPlatforms.metaUserData), shown so the owner can read
 * Meta's coverage figures against what is actually sent.
 */
export const META_KEYS_SENT: ReadonlyArray<{ on: string; keys: string[]; note: string }> = [
  { on: 'Every event', keys: ['Visitor ID', 'Browser ID (fbp)', 'IP address', 'Browser (user agent)'], note: 'The browser ID is derived from the visitor ID: the shop runs no Meta Pixel and sets no Meta cookie.' },
  { on: 'When the visitor arrived from a Meta ad (last 30 days)', keys: ['Click ID (fbc)'], note: 'Built from the fbclid on the landing page link.' },
  { on: 'A paid order', keys: ['Email', 'Phone', 'First name', 'Last name', 'City', 'Country'], note: 'Hashed (SHA-256) before they leave the shop. City is the delivery district; the email is sent only when the customer gave one.' },
];
