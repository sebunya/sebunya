/**
 * Location pins from WhatsApp (address system spec §5, as corrected by the
 * review board on 2026-10-15). Pure rules, no I/O.
 *
 * A pin is a front door. Nothing here stores one; the use case does, after
 * the customer confirms "deliver here", with a purge date, and never into
 * the assistant archive. These functions decide what a pin can mean and how
 * the buttons that ask about it are named.
 */
import { haversineKm, isWithinUganda } from './DeliveryOrigin';

export interface PinPoint {
  lat: number;
  lng: number;
}

export type PinRejection = 'outside_uganda' | 'at_shop';

/**
 * A pin that cannot be a delivery address: outside Uganda, or within a few
 * hundred metres of the shop itself (a customer tapping "send location" while
 * standing in the shop, or a rider at the hub). Refused with a reply, stored
 * nowhere.
 */
export function pinSanity(point: PinPoint, origin: PinPoint | null, minFromOriginM = 300): PinRejection | null {
  if (!isWithinUganda(point.lat, point.lng)) return 'outside_uganda';
  if (origin && haversineKm(origin, point) * 1000 < minFromOriginM) return 'at_shop';
  return null;
}

/** Straight-line km from a pin to the area's own point, or null when the area has none. */
export function pinDisagreementKm(point: PinPoint, areaPoint: PinPoint | null): number | null {
  if (!areaPoint) return null;
  return Math.round(haversineKm(point, areaPoint) * 100) / 100;
}

export interface ReplyButton {
  /** ≤ 256 characters; the grammar below. */
  id: string;
  /** ≤ 20 characters: the Cloud API's limit for a reply button title. */
  title: string;
}

/** The Cloud API allows three reply buttons per message. */
export const MAX_REPLY_BUTTONS = 3;

const WAMID = /^[A-Za-z0-9._=+\-/]{4,160}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Button ids, so a tap can be verified against what was asked: the message
 * id it belongs to, the order it is about, and the answer. A typed word is
 * never an answer; only an id that parses is.
 */
export const pinButton = {
  whichOrder: (wamid: string, orderId: string): string => `loc:${wamid}:${orderId}`,
  confirm: (wamid: string, orderId: string, yes: boolean): string => `locok:${wamid}:${orderId}:${yes ? 'y' : 'n'}`,
  save: (orderId: string, yes: boolean): string => `locsave:${orderId}:${yes ? 'y' : 'n'}`,
  handover: (wamid: string, taskId: string, outcome: 'delivered' | 'absent' | 'notfound'): string => `ho:${wamid}:${taskId}:${outcome}`,
  whichStop: (wamid: string, taskId: string): string => `hos:${wamid}:${taskId}`,
  findDifficulty: (taskId: string, difficulty: 'easy' | 'hard'): string => `hf:${taskId}:${difficulty}`,
};

export type ParsedPinButton =
  | { kind: 'which_order'; wamid: string; orderId: string }
  | { kind: 'confirm'; wamid: string; orderId: string; yes: boolean }
  | { kind: 'save'; orderId: string; yes: boolean }
  | { kind: 'handover'; wamid: string; taskId: string; outcome: 'delivered' | 'absent' | 'notfound' }
  | { kind: 'which_stop'; wamid: string; taskId: string }
  | { kind: 'find_difficulty'; taskId: string; difficulty: 'easy' | 'hard' };

export function isPinButton(id: string | null | undefined): boolean {
  return parsePinButton(id) !== null;
}

export function parsePinButton(id: string | null | undefined): ParsedPinButton | null {
  if (typeof id !== 'string' || id.length > 256) return null;
  const parts = id.split(':');
  const [kind] = parts;
  if (kind === 'loc' && parts.length === 3 && WAMID.test(parts[1]) && UUID.test(parts[2])) {
    return { kind: 'which_order', wamid: parts[1], orderId: parts[2] };
  }
  if (kind === 'locok' && parts.length === 4 && WAMID.test(parts[1]) && UUID.test(parts[2]) && /^[yn]$/.test(parts[3])) {
    return { kind: 'confirm', wamid: parts[1], orderId: parts[2], yes: parts[3] === 'y' };
  }
  if (kind === 'locsave' && parts.length === 3 && UUID.test(parts[1]) && /^[yn]$/.test(parts[2])) {
    return { kind: 'save', orderId: parts[1], yes: parts[2] === 'y' };
  }
  if (kind === 'ho' && parts.length === 4 && WAMID.test(parts[1]) && UUID.test(parts[2]) && /^(delivered|absent|notfound)$/.test(parts[3])) {
    return { kind: 'handover', wamid: parts[1], taskId: parts[2], outcome: parts[3] as 'delivered' | 'absent' | 'notfound' };
  }
  if (kind === 'hos' && parts.length === 3 && WAMID.test(parts[1]) && UUID.test(parts[2])) {
    return { kind: 'which_stop', wamid: parts[1], taskId: parts[2] };
  }
  if (kind === 'hf' && parts.length === 3 && UUID.test(parts[1]) && /^(easy|hard)$/.test(parts[2])) {
    return { kind: 'find_difficulty', taskId: parts[1], difficulty: parts[2] as 'easy' | 'hard' };
  }
  return null;
}

/** A reply button title within the Cloud API's 20 characters. */
export function buttonTitle(text: string): string {
  const t = text.trim();
  return t.length <= 20 ? t : `${t.slice(0, 19)}…`;
}

/**
 * When the channel cannot show buttons (an old client, or a messenger without
 * interactive support), the same choice is offered as numbered lines and the
 * customer's "1", "2" or "3" is matched back to a button id.
 */
export function numberedFallback(body: string, buttons: readonly ReplyButton[]): string {
  return `${body}\n${buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n')}\nReply with the number.`;
}

export function matchNumberedReply(text: string, buttons: readonly ReplyButton[]): ReplyButton | null {
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < 1 || n > buttons.length) return null;
  return buttons[n - 1];
}

/** Retention: a pin on an order is deleted after this many days from capture (owner's registry value; 30–365). */
export function purgeDate(capturedAt: Date, retentionDays: number): Date {
  const days = Number.isFinite(retentionDays) ? Math.min(365, Math.max(30, Math.round(retentionDays))) : 180;
  return new Date(capturedAt.getTime() + days * 86_400_000);
}
