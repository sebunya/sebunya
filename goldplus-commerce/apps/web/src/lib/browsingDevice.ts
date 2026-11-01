/**
 * The phone model THIS browser reports about itself, or null.
 *
 * It is a suggestion to confirm, never a fact: the shopper may be buying for
 * someone else, the value is client-controlled, and most browsers withhold it
 * (reduced Chrome sends "K", iPhone/iPad/Mac never name a model). Anything
 * that is not a plausible model code is treated as unknown — nothing is
 * guessed from a brand token, a screen size or "AppleWebKit".
 */
const PLACEHOLDERS = new Set(['k', 'android', 'mobile', 'tablet', 'linux', 'wv', 'unknown']);

export function plausibleModelCode(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (value.length < 3 || value.length > 40) return null;
  if (PLACEHOLDERS.has(value.toLowerCase())) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._+\-()]*$/.test(value)) return null;
  if (!/\d/.test(value)) return null; // model codes carry a digit; "Android" style words do not
  return value;
}

/** Legacy (unreduced) Android UA: "...; Android 12; TECNO KG5k Build/..." */
export function modelFromUserAgent(ua: string | null | undefined): string | null {
  const m = /Android [^;)]+;\s*([^;)]+?)(?:\s+Build\/|\))/.exec(ua ?? '');
  return plausibleModelCode(m?.[1]);
}
