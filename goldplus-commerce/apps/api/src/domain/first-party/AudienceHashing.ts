/**
 * Hashed identifiers for ad-platform audiences (0155). ONE set of rules: this
 * file delegates every normalisation and hash to
 * domain/advertising/ContactNormalisation (hashedContactFor), the module that
 * sends to the platforms, so a customer hashes the same way whichever path
 * built the audience (docs/advertising/README.md, "Hashing").
 *
 * The raw email and phone never leave this function; the audience consumer
 * only ever sees SHA-256 lowercase hex.
 */
import { hashedContactFor, normaliseEmailGoogle, type AudiencePlatform, type HashedContact } from '../advertising/ContactNormalisation';

export interface PlatformHashedIdentifiers {
  /** Meta and TikTok: trimmed, lower-cased email. */
  emailSha256: string | null;
  /** Google Customer Match: gmail.com / googlemail.com lose dots and "+suffix". */
  emailSha256Google: string | null;
  /** '+256…' (E.164 with the plus): Google, TikTok. */
  phoneSha256E164: string | null;
  /** '256…' (digits only, country code first): Meta. */
  phoneSha256Digits: string | null;
}

/** Google's email rule, exposed for display and tests; null when not an email. */
export function googleNormalisedEmail(email: string): string | null {
  return normaliseEmailGoogle(email);
}

export function hashForAdPlatforms(input: { email?: string | null; phone?: string | null }): PlatformHashedIdentifiers {
  const google = hashedContactFor('google_ads', input);
  const meta = hashedContactFor('meta', input);
  return {
    emailSha256: meta.email,
    emailSha256Google: google.email,
    phoneSha256E164: google.phone,
    phoneSha256Digits: meta.phone,
  };
}

/** The hashes one platform takes, from the platform-neutral set. */
export function hashesForPlatform(h: PlatformHashedIdentifiers, platform: AudiencePlatform): HashedContact {
  if (platform === 'google_ads') return { email: h.emailSha256Google, phone: h.phoneSha256E164 };
  if (platform === 'meta') return { email: h.emailSha256, phone: h.phoneSha256Digits };
  return { email: h.emailSha256, phone: h.phoneSha256E164 };
}

export function hasAnyIdentifier(h: PlatformHashedIdentifiers): boolean {
  return !!(h.emailSha256 || h.phoneSha256E164);
}
