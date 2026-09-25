import { createHash } from 'node:crypto';

/**
 * Contact details as each advertising platform wants them BEFORE SHA-256
 * (docs/advertising/README.md, "Hashing"). Pure: no network, no storage.
 *
 *  - Google (Customer Match, enhanced conversions): email trimmed and
 *    lower-cased; for gmail.com / googlemail.com the dots and any "+suffix"
 *    are removed from the local part. Phone in E.164 WITH the leading '+'.
 *  - Meta (Custom Audiences, Conversions API): email trimmed and lower-cased.
 *    Phone as digits only, country code first, no '+', no leading zeros.
 *  - TikTok (customer files, Events API): email trimmed and lower-cased.
 *    Phone in E.164 WITH the leading '+'.
 *
 * Numbers are Ugandan unless they already carry a country code: 07XXXXXXXX,
 * 7XXXXXXXX, +256…, 00256… all become 2567XXXXXXXX.
 */

export const sha256Hex = (v: string): string => createHash('sha256').update(v).digest('hex');

/** E.164 digits (no '+'), or null when the value cannot be a phone number. */
export function phoneDigitsE164(phone?: string | null): string | null {
  const d = String(phone ?? '').replace(/\D/g, '').replace(/^00/, '');
  if (/^0\d{9}$/.test(d)) return `256${d.slice(1)}`;
  if (/^256\d{9}$/.test(d)) return d;
  if (/^7\d{8}$/.test(d)) return `256${d}`;
  return d.length >= 10 && d.length <= 15 && !d.startsWith('0') ? d : null;
}

/** Trimmed, lower-cased email, or null when it is not an email address. */
export function normaliseEmail(email?: string | null): string | null {
  const e = String(email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Google's rule: gmail.com / googlemail.com lose dots and "+suffix" in the local part. */
export function normaliseEmailGoogle(email?: string | null): string | null {
  const e = normaliseEmail(email);
  if (!e) return null;
  const at = e.lastIndexOf('@');
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return e;
  const clean = local.split('+')[0].replace(/\./g, '');
  return clean ? `${clean}@${domain}` : null;
}

export type AudiencePlatform = 'google_ads' | 'meta' | 'tiktok';

export interface HashedContact {
  email: string | null;
  phone: string | null;
}

/** One person's contact, hashed the way the given platform documents. */
export function hashedContactFor(platform: AudiencePlatform, contact: { email?: string | null; phone?: string | null }): HashedContact {
  const digits = phoneDigitsE164(contact.phone);
  if (platform === 'google_ads') {
    const e = normaliseEmailGoogle(contact.email);
    return { email: e ? sha256Hex(e) : null, phone: digits ? sha256Hex(`+${digits}`) : null };
  }
  const e = normaliseEmail(contact.email);
  if (platform === 'meta') return { email: e ? sha256Hex(e) : null, phone: digits ? sha256Hex(digits) : null };
  return { email: e ? sha256Hex(e) : null, phone: digits ? sha256Hex(`+${digits}`) : null };
}

/**
 * Every hash variant stored for an admin-recorded sale, so the plaintext is
 * never kept: Meta/TikTok email, Google email, digits phone (Meta), '+' phone
 * (Google, TikTok).
 */
export function offlineSaleHashes(contact: { email?: string | null; phone?: string | null }) {
  const e = normaliseEmail(contact.email);
  const g = normaliseEmailGoogle(contact.email);
  const d = phoneDigitsE164(contact.phone);
  return {
    emailSha256: e ? sha256Hex(e) : null,
    emailGoogleSha256: g ? sha256Hex(g) : null,
    phoneDigitsSha256: d ? sha256Hex(d) : null,
    phonePlusSha256: d ? sha256Hex(`+${d}`) : null,
  };
}

/** The spellings a stored phone number may have, for matching it to an order or account. */
export function phoneSpellings(phone?: string | null): string[] {
  const d = phoneDigitsE164(phone);
  if (!d) return [];
  const out = new Set([d, `+${d}`]);
  if (d.startsWith('256') && d.length === 12) { out.add(`0${d.slice(3)}`); out.add(d.slice(3)); }
  return [...out];
}
