/**
 * Goldie's welcome and her pacing, in one tested place.
 *
 * The welcome is what a good shopkeeper says to someone they recognise: the
 * time of day, the name once if we know it, "welcome back" for a returning
 * shopper, and what they were after last time, offered, never assumed.
 * Everything comes from /api/assistant/hello (the shop's own records).
 */
export interface GoldieHello {
  firstName: string | null;
  returning: boolean;
  regular: boolean;
  hasOrdered: boolean;
  lastInterest: string | null;
  recentlyViewed: string | null;
}

export const NO_HELLO: GoldieHello = { firstName: null, returning: false, regular: false, hasOrdered: false, lastInterest: null, recentlyViewed: null };

/** Kampala hour 0-23 (the shop's clock, not the device's). */
export function kampalaHour(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', hour: 'numeric', hourCycle: 'h23' }).format(now)) % 24;
}

export const salutation = (hour: number) => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');

/** A topic is safe to say back only when it is short and reads as a thing ("power banks", "Tecno Spark 10 battery"). */
const sayable = (t: string | null): string | null => {
  const s = (t ?? '').replace(/\s+/g, ' ').trim();
  return s && s.length <= 40 && /^[\p{L}\p{N} .,'&+/-]+$/u.test(s) ? s : null;
};

export function goldieGreeting(h: GoldieHello, hour: number, phoneKnown = ''): string {
  const hi = `${salutation(hour)}${h.firstName ? ` ${h.firstName}` : ''}`;
  const interest = sayable(h.lastInterest);
  if (h.returning || h.regular) {
    if (interest) return `${hi}, welcome back. Last time you were looking at ${interest}. Shall I pick up from there, or is it something new today?`;
    return `${hi}, welcome back to GoldPlus. What can I find for you today?`;
  }
  if (h.firstName) return `${hi}, I'm Goldie, your GoldPlus personal shopper. What can I find for you today?`;
  const forPhone = phoneKnown ? ` I can also check what fits your ${phoneKnown}.` : '';
  return `${hi}, I'm Goldie, your GoldPlus personal shopper. Tell me what you are looking for, a charger, a cable, a power bank or a battery, and I'll check the shelf for you.${forPhone}`;
}

/** The returning shopper's first starter chip: straight back to what they were after. */
export function returningChip(h: GoldieHello): { label: string; ask: string } | null {
  const interest = sayable(h.lastInterest);
  if (!(h.returning || h.regular) || !interest || interest.length > 24) return null;
  return { label: `Back to ${interest}`, ask: `Show me ${interest}` };
}

/** A teaser line keeps its question; a returning shopper is still greeted as one. */
export function welcomeTeaser(teaser: string, h: GoldieHello): string {
  if (!(h.returning || h.regular)) return teaser;
  return `Welcome back${h.firstName ? `, ${h.firstName}` : ''}. ${teaser}`;
}

/**
 * Pacing, so Goldie answers like a person typing, not a machine dumping text:
 * a short pause to "read" the question (longer questions, a little longer),
 * then the reply appears word by word. Capped, so a long answer never keeps a
 * shopper waiting: the whole reveal finishes inside REVEAL_MAX_MS.
 */
export const READ_MIN_MS = 650;
export const READ_MAX_MS = 1600;
export const REVEAL_CPS = 70; // characters per second while "typing"
export const REVEAL_MAX_MS = 2600;

export function readPauseMs(question: string): number {
  return Math.min(READ_MAX_MS, READ_MIN_MS + Math.round(question.trim().length * 12));
}

/** Characters to reveal per 40 ms tick for an answer of this length (faster for long answers, so the cap holds). */
export function revealStep(totalChars: number): number {
  const naturalMs = (totalChars / REVEAL_CPS) * 1000;
  const scale = naturalMs > REVEAL_MAX_MS ? naturalMs / REVEAL_MAX_MS : 1;
  return Math.max(1, Math.ceil((REVEAL_CPS * scale * 40) / 1000));
}

/** Plain-text copy of a chat, for "Save or share" (the panel's own words, with a header the shopper can recognise later). */
export function transcriptText(turns: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>, at: Date = new Date()): string {
  const when = at.toLocaleString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return [`Chat with Goldie, GoldPlus personal shopper (${when})`, 'shopgoldplus.com', '', ...turns.map((t) => `${t.role === 'user' ? 'You' : 'Goldie'}: ${t.content}`)].join('\n\n');
}
