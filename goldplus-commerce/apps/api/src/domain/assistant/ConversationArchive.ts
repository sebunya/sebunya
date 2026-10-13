/**
 * Rules for the Goldie conversation archive (0177). Pure: no I/O.
 *
 * What is kept is what a care team needs to follow a customer up and to learn
 * from: the words, the topic, how the customer felt and how it ended. What is
 * never kept is a secret: card numbers, PINs, OTPs and passwords are replaced
 * before anything is stored, whatever the customer typed.
 */

export type ArchiveChannel = 'web' | 'whatsapp';
export type ArchiveRole = 'customer' | 'goldie' | 'team';
export type ArchiveMood = 'upset' | 'worried' | 'confused' | 'happy' | 'neutral';
/** open: in progress; resolved: answered and closed; handed_over: passed to the team; needs_human: upset and not settled. */
export type ArchiveOutcome = 'open' | 'resolved' | 'handed_over' | 'needs_human';

export const ARCHIVE_RETENTION_DAYS = 365;
export const MAX_ARCHIVED_MESSAGE = 4000;

const MOOD_RANK: Record<ArchiveMood, number> = { upset: 4, worried: 3, confused: 2, neutral: 1, happy: 0 };
export const isMood = (m: unknown): m is ArchiveMood => typeof m === 'string' && m in MOOD_RANK;
/** The worse of two moods: a conversation is filed under the lowest point the customer reached. */
export const worseMood = (a: ArchiveMood, b: ArchiveMood): ArchiveMood => (MOOD_RANK[b] > MOOD_RANK[a] ? b : a);

// eslint-disable-next-line no-control-regex -- stripping control characters IS the point
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Card numbers (13-19 digits, spaced or dashed), and any code that follows pin / otp / password / cvv. */
export function redact(raw: string): string {
  return raw
    .replace(CONTROL, '')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[card number removed]')
    .replace(/\b(pin|otp|one[- ]time (?:pin|code)|password|passcode|cvv|cvc|security code|m-?pin)\b(\s*(?:is|was|:|=|-)?\s*)(\S{3,32})/gi, (_m, k: string, sep: string) => `${k}${sep}[removed]`)
    .trim()
    .slice(0, MAX_ARCHIVED_MESSAGE);
}

/**
 * How a conversation stands after a turn. A handover or a team takeover is never undone by a later
 * message; an upset customer with no handover is flagged for a person; a happy customer after an
 * answer closes it as resolved.
 */
export function nextOutcome(current: ArchiveOutcome, turn: { mood: ArchiveMood; handedOver?: boolean }): ArchiveOutcome {
  if (turn.handedOver || current === 'handed_over') return 'handed_over';
  if (turn.mood === 'upset') return 'needs_human';
  if (turn.mood === 'happy' && current !== 'needs_human') return 'resolved';
  if (current === 'resolved' && turn.mood !== 'happy') return 'open';
  return current;
}

/** The meeting view: what customers came for, how they felt, how it ended, and what still needs a person. */
export interface MeetingSummary {
  from: string;
  to: string;
  conversations: number;
  customerMessages: number;
  byChannel: Record<string, number>;
  byTopic: Array<{ topic: string; count: number }>;
  byMood: Record<string, number>;
  byOutcome: Record<string, number>;
  /** Share of conversations Goldie closed without a person (resolved + open with no upset), 0..1; null with no data. */
  selfServeRate: number | null;
  /** Average customer rating (1-5) of conversations in the period, and how many rated. */
  csatAverage: number | null;
  csatCount: number;
  /** How Goldie's answers were produced (deterministic, cache, ai, fallback). */
  byRoute: Record<string, number>;
  /**
   * Paid orders by the same shopper within 7 days after a chat (by server profile or account). Influence, not proof
   * of cause. conversionRate is over conversations that can be linked to a shopper at all; hintConversionRate is the
   * same for conversations where Goldie had a next-best-action hint.
   */
  influence: { linkableConversations: number; orders: number; revenueUgx: number; conversionRate: number | null; withHint: number; hintConversionRate: number | null };
  needsFollowUp: Array<{ id: string; channel: string; contact: string | null; topic: string | null; mood: string; lastMessageAt: string; lastCustomerLine: string }>;
}

export function selfServeRate(byOutcome: Record<string, number>): number | null {
  const total = Object.values(byOutcome).reduce((s, n) => s + n, 0);
  if (!total) return null;
  return ((byOutcome.resolved ?? 0) + (byOutcome.open ?? 0)) / total;
}
