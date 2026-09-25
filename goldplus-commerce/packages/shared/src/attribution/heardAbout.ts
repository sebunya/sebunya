/**
 * Self-reported source ("How did you hear about us?") and the WhatsApp
 * reference code. Shared by the storefront (checkout question, click-to-chat
 * tagging), the admin order page and the API, so the three cannot drift.
 *
 * The answer list is CLOSED: a free-text box would be unreportable. Every
 * answer is optional; "prefer not to say" is the empty value, never stored.
 * Ambiguous answers stay ambiguous: a customer who says "Facebook" cannot tell
 * an ad from a friend's post, so it is filed as "social media (customer said)",
 * never as paid social.
 */
export const HEARD_ABOUT_ANSWERS = [
  'search',
  'facebook',
  'instagram',
  'tiktok',
  'whatsapp',
  'creator',
  'friend',
  'radio_tv',
  'returning',
  'other',
] as const;
export type HeardAboutAnswer = typeof HEARD_ABOUT_ANSWERS[number];

export const HEARD_ABOUT_LABELS: Record<HeardAboutAnswer, string> = {
  search: 'Google or another search',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  creator: 'A creator or influencer',
  friend: 'A friend or family member',
  radio_tv: 'Radio, TV or print',
  returning: 'I have bought from GoldPlus before',
  other: 'Somewhere else',
};

export const HEARD_ABOUT_OPTIONS: ReadonlyArray<{ value: HeardAboutAnswer; label: string }> =
  HEARD_ABOUT_ANSWERS.map((value) => ({ value, label: HEARD_ABOUT_LABELS[value] }));

/** A known answer, or null. Unknown values are dropped, never guessed at. */
export function parseHeardAbout(value: unknown): HeardAboutAnswer | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return (HEARD_ABOUT_ANSWERS as readonly string[]).includes(v) ? (v as HeardAboutAnswer) : null;
}

/**
 * WhatsApp reference: `GP-` + 6 characters from an alphabet without the
 * look-alikes (0/O, 1/I/L, U/V pairs kept apart), so a person can read it out
 * of a chat and type it back. 30^6 ≈ 729 million codes.
 */
export const WHATSAPP_REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const WHATSAPP_REF_LENGTH = 6;
export const WHATSAPP_REF_PATTERN = /^GP-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

/**
 * Accepts what an admin is likely to paste: "Ref GP-7K3Q9X", "gp 7k3q9x",
 * "7K3Q9X". Returns the canonical `GP-XXXXXX`, or null when it is not a code.
 */
export function normaliseWhatsAppRef(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.toUpperCase().replace(/^\s*REF[:\s]*/, '').replace(/[\s_-]+/g, '');
  // Bare six characters, or the prefixed eight: a bare code may itself start with "GP".
  const body = compact.length === WHATSAPP_REF_LENGTH + 2 && compact.startsWith('GP') ? compact.slice(2) : compact;
  const code = `GP-${body}`;
  return WHATSAPP_REF_PATTERN.test(code) ? code : null;
}
