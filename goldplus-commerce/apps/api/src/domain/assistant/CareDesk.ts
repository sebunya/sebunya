/**
 * The Care Desk: the work Goldie hands to people, and when she should stay
 * quiet. Pure rules, no I/O.
 *
 * Goldie answers what she can prove from the shop's systems. What needs a
 * person (a callback, a promised follow-up, an order change, a bulk lead, an
 * angry or stuck customer) becomes a task on the desk; the urgent ones also
 * reach the on-duty team by SMS, email and WhatsApp, at most once per task.
 */

/** Goldie's own actor id in the audit log and refund ledger: every action she takes is filed under it. */
export const GOLDIE_ACTOR_ID = '601d1e00-0000-4000-8000-000000000001';

export type CareTaskKind = 'callback' | 'follow_up' | 'order_change' | 'order_problem' | 'bulk_lead' | 'urgent';
export type CarePriority = 'urgent' | 'high' | 'normal';
export type CareStatus = 'open' | 'done' | 'cancelled';
export const CARE_KINDS: readonly CareTaskKind[] = ['callback', 'follow_up', 'order_change', 'order_problem', 'bulk_lead', 'urgent'];
export const isCareKind = (k: unknown): k is CareTaskKind => typeof k === 'string' && (CARE_KINDS as readonly string[]).includes(k);

/** Plain words for the people who work the desk. */
export const CARE_KIND_LABEL: Record<CareTaskKind, string> = {
  callback: 'Call the customer back',
  follow_up: 'Follow up',
  order_change: 'Order change to approve',
  order_problem: 'Problem with an order',
  bulk_lead: 'Bulk buyer',
  urgent: 'Urgent: customer needs a person now',
};

/**
 * How urgent a new task is. An upset customer about money, a missing order or a fault is urgent; a bulk lead
 * worth chasing today is high; everything else is normal. The caller may raise it, never lower it below this.
 */
export function carePriority(input: { kind: CareTaskKind; mood?: string | null; urgentHint?: boolean; units?: number | null }): CarePriority {
  if (input.kind === 'urgent') return 'urgent';
  if (input.urgentHint || (input.mood === 'upset' && ['order_problem', 'order_change', 'callback'].includes(input.kind))) return 'urgent';
  if (input.kind === 'bulk_lead' && (input.units ?? 0) >= 50) return 'high';
  if (input.kind === 'order_problem' || input.kind === 'order_change' || input.mood === 'worried') return 'high';
  return 'normal';
}

/** Only urgent tasks page people; everything else waits on the desk. */
export const shouldAlert = (p: CarePriority) => p === 'urgent';

/** An urgent task nobody has taken pages again after this long, at most MAX_ESCALATIONS times. */
export const ESCALATE_AFTER_MIN = 15;
export const MAX_ESCALATIONS = 2;

/** Whether an urgent task has waited too long untouched and should page the whole team again. */
export function needsEscalation(t: { priority: string; status: string; assignedTo: string | null; createdAt: Date; escalations: number; lastEscalatedAt: Date | null }, now: Date): boolean {
  if (t.priority !== 'urgent' || t.status !== 'open' || t.assignedTo) return false;
  if (t.escalations >= MAX_ESCALATIONS) return false;
  const since = (t.lastEscalatedAt ?? t.createdAt).getTime();
  return now.getTime() - since >= ESCALATE_AFTER_MIN * 60_000;
}

/** Shop-wide ceiling on paging alerts per hour (CARE_ALERTS_PER_HOUR); the desk still shows every urgent task. */
export const DEFAULT_ALERTS_PER_HOUR = 12;

/**
 * Whether paging is allowed: one alert per customer number per 30 minutes (a new chat from the same person is
 * not a new emergency), and at most `perHour` alerts across the shop, so nobody can run up an SMS bill or flood
 * the team by opening chats. A throttled urgent task still sits at the top of the Care Desk.
 */
export function alertAllowed(input: { samePhoneLast30Min: number; shopLastHour: number; perHour: number }): 'ALLOWED' | 'SAME_CUSTOMER_RECENTLY' | 'HOURLY_CAP' {
  if (input.samePhoneLast30Min > 0) return 'SAME_CUSTOMER_RECENTLY';
  if (input.shopLastHour >= input.perHour) return 'HOURLY_CAP';
  return 'ALLOWED';
}

export interface OnDuty { days?: number[]; from?: string; to?: string }

/** Is a team member on duty now (Kampala time)? No schedule means always. Overnight ranges (22:00-06:00) work. */
export function onDutyNow(schedule: OnDuty | null | undefined, now: Date = new Date()): boolean {
  if (!schedule || (!schedule.days && !schedule.from && !schedule.to)) return true;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
  const minutes = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  if (schedule.days && schedule.days.length && !schedule.days.includes(wd)) return false;
  const m = (s?: string) => { const x = /^(\d{1,2}):(\d{2})$/.exec(s ?? ''); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const from = m(schedule.from), to = m(schedule.to);
  if (from === null || to === null) return true;
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** The SMS a team member gets (one message, under 300 characters, with who to call). */
export function alertText(t: { kind: CareTaskKind; title: string; customerName?: string | null; customerPhone?: string | null; orderNumber?: string | null }): string {
  const who = [t.customerName, t.customerPhone].filter(Boolean).join(' ');
  const s = `GoldPlus Care: ${CARE_KIND_LABEL[t.kind]}. ${t.title}${t.orderNumber ? ` (${t.orderNumber})` : ''}${who ? `. Customer: ${who}` : ''}. Open the Care Desk.`;
  return s.length <= 300 ? s : `${s.slice(0, 297)}...`;
}

// ---- When not to answer (WhatsApp; the website always answers the person in front of it) ----

const ACK_ONLY = /^(ok(ay)?|k|kk|sure|fine|alright|noted|yes|yeah|yep|👍|👌|🙏|🙂|😊|❤️|thanks?|thank you|thx|asante|webale( nnyo)?|okay thanks|ok thanks|thank you so much|cool|great)[.!\s]*$/iu;
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u;

export type SilenceReason = 'TEAM_HAS_IT' | 'ACK_AFTER_CLOSE' | 'EMOJI_ONLY' | 'REPEATED' | 'STAFF_NUMBER' | 'ABUSE_LIMIT';

/**
 * Whether Goldie should stay quiet on this message. A person at the counter does not answer "ok 👍" after
 * the matter is settled, does not reply to the same message pasted five times, and lets a colleague who has
 * taken the customer carry on. Silence is filed with its reason; the message is never lost.
 */
export function silenceFor(input: {
  text: string;
  teamHasIt: boolean;
  fromStaff: boolean;
  /** Goldie's last message closed the matter (an answer with nothing left open, or a goodbye). */
  lastGoldieClosed: boolean;
  /** How many times the same text arrived from this number in the last 10 minutes (including this one). */
  sameTextRecently: number;
  /** Abusive messages from this number in the last hour. */
  abuseRecently: number;
}): SilenceReason | null {
  const t = input.text.trim();
  if (input.fromStaff) return 'STAFF_NUMBER';
  if (input.teamHasIt) return 'TEAM_HAS_IT';
  if (input.abuseRecently >= 3) return 'ABUSE_LIMIT';
  if (input.sameTextRecently >= 3) return 'REPEATED';
  if (EMOJI_ONLY.test(t)) return 'EMOJI_ONLY';
  if (ACK_ONLY.test(t) && input.lastGoldieClosed) return 'ACK_AFTER_CLOSE';
  return null;
}

const ABUSE = /\b(fuck|f\*ck|shit|bitch|bastard|idiot|stupid|fool|mjinga|kumanyoko|nyoko|malaya|wolokoso)\b/i;
export const isAbusive = (text: string) => ABUSE.test(text);

/** Goldie's last line left nothing open (no question to the customer, or a closing line). */
export function closesMatter(goldieText: string): boolean {
  const t = goldieText.trim();
  if (/\?\s*$/.test(t)) return false;
  return true;
}

export interface CareDeskToday {
  openTasks: number;
  urgentOpen: number;
  callbacksOpen: number;
  approvalsOpen: number;
  bulkLeadsOpen: number;
  chatsToday: number;
  handledByGoldieToday: number;
  needsPersonToday: number;
  csatAverage: number | null;
  csatCount: number;
  /** When the longest-waiting open task was opened (null when nothing is open). */
  oldestOpenAt: string | null;
  /** When the longest-waiting urgent task nobody has taken was opened (null when none). */
  oldestUrgentAt?: string | null;
}
