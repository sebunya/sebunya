import { sha256Hex } from './ContactNormalisation';

/**
 * The identifiers Meta's Conversions API matches on, as Meta specifies them
 * (2026-10-01). Pure: no network, no storage.
 *
 * Why this exists. The shop sends events server to server and runs no Meta
 * Pixel in the browser (owner decision 2026-09-19). The code nevertheless
 * read Meta's click id and browser id from `_fbc` / `_fbp` — cookies only
 * the Pixel sets — and never looked at the `fbclid` on the landing URL. So
 * every event reached Meta without its two strongest match keys, and nothing
 * on the admin page said so.
 *
 * Sources (Meta for Developers, Conversions API):
 *  - fbc: `fb.<subdomain index>.<creation time ms>.<fbclid>`; subdomain index
 *    1 for a value built on the server; creation time is when the fbclid was
 *    first observed; the fbclid is case sensitive and must not be altered.
 *  - fbp: `fb.<subdomain index>.<creation time ms>.<random number>`.
 *  - fn / ln: lower case, no punctuation. ct: lower case, no spaces or
 *    punctuation. country: lower-case ISO 3166-1 alpha-2, always sent when
 *    known. All four are SHA-256 hashed; fbc, fbp, IP and user agent are not.
 */

/** A value the browser may have been handed, so it is checked before it is believed. */
const FBC = /^fb\.[0-9]\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/;
const FBP = /^fb\.[0-9]\.\d{10,13}\.\d{1,20}$/;
const FBCLID = /^[A-Za-z0-9_-]{8,500}$/;

export const isMetaClickId = (v: unknown): v is string => typeof v === 'string' && FBC.test(v);
export const isMetaBrowserId = (v: unknown): v is string => typeof v === 'string' && FBP.test(v);

/** `fb.1.<first observed, ms>.<fbclid>`, or null when the parameter is not a click id. The fbclid is used exactly as received. */
export function metaClickIdFromParam(fbclid: unknown, observedAtMs: number): string | null {
  if (typeof fbclid !== 'string' || !FBCLID.test(fbclid) || !Number.isFinite(observedAtMs) || observedAtMs <= 0) return null;
  return `fb.1.${Math.floor(observedAtMs)}.${fbclid}`;
}

/**
 * A browser id for a shop that runs no Pixel, in Meta's own format.
 *
 * It is DERIVED from the first-party visitor id (`fp.<ms>.<uuid>`, set by our
 * server on the first page), not stored: the creation time is the visitor
 * id's own, and the number is taken from its hash. The same browser therefore
 * always presents the same browser id — which is all a browser id is for —
 * and no second cookie is set to carry it.
 */
export function metaBrowserIdFromVisitor(fpClientId: unknown): string | null {
  if (typeof fpClientId !== 'string') return null;
  const m = /^fp\.(\d{10,13})\.[A-Za-z0-9-]{8,}$/.exec(fpClientId);
  if (!m) return null;
  // Ten decimal digits, never starting with 0: the shape of the Pixel's own random number.
  const n = (BigInt(`0x${sha256Hex(fpClientId).slice(0, 15)}`) % 9_000_000_000n) + 1_000_000_000n;
  return `fb.1.${m[1]}.${n.toString()}`;
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A given or family name as Meta hashes it: lower case, letters only (accents folded; other scripts kept). */
export function metaNamePart(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = fold(v).replace(/[^\p{L}]/gu, '');
  return t.length >= 1 && t.length <= 100 ? t : null;
}

/**
 * First and last name from the one "customer name" field an order carries.
 * A single word is a first name only: half a name is not guessed into a
 * family name. Titles are not names.
 */
export function splitCustomerName(full: unknown): { first: string | null; last: string | null } {
  if (typeof full !== 'string') return { first: null, last: null };
  const words = full.trim().split(/\s+/).filter((w) => !/^(mr|mrs|ms|miss|dr|prof|sir|hon|rev|eng)\.?$/i.test(w));
  const parts = words.map(metaNamePart).filter((w): w is string => !!w);
  if (parts.length === 0) return { first: null, last: null };
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : null };
}

/** A city (here: the delivery district) as Meta hashes it: lower case, no spaces or punctuation. */
export function metaCity(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = fold(v).replace(/[^\p{L}\p{N}]/gu, '');
  return t.length >= 2 && t.length <= 100 ? t : null;
}

/** ISO 3166-1 alpha-2, lower case; null for anything else. */
export function metaCountry(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toLowerCase() : null;
}

export interface MetaCustomerHashes {
  hashed_first_name?: string;
  hashed_last_name?: string;
  hashed_city?: string;
  hashed_country?: string;
}

/**
 * The hashed customer details a paid order can add to its purchase event.
 * Only what the order states: a name the customer typed, the district the
 * order is delivered to, and the country the shop delivers in.
 */
export function metaCustomerHashes(input: { customerName?: unknown; city?: unknown; country?: unknown }): MetaCustomerHashes {
  const { first, last } = splitCustomerName(input.customerName);
  const city = metaCity(input.city);
  const country = metaCountry(input.country);
  return {
    ...(first ? { hashed_first_name: sha256Hex(first) } : {}),
    ...(last ? { hashed_last_name: sha256Hex(last) } : {}),
    ...(city ? { hashed_city: sha256Hex(city) } : {}),
    ...(country ? { hashed_country: sha256Hex(country) } : {}),
  };
}
