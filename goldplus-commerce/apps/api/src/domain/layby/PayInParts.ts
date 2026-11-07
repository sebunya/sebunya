/**
 * Pay in parts (lay-by), owner rules decided 2026-11-07 (migration 0222).
 *
 * The customer pays a deposit now, the rest in any number of payments within the term, and the goods are held for
 * them and handed over only once everything is paid. Every number below is a setting (layby_settings) with the
 * owner's decision as its default; nothing here is hard-wired into a use case.
 *
 * Pure: no framework, no database, no clock of its own.
 */

export type LaybyPlanStatus = 'awaiting_deposit' | 'active' | 'paid' | 'lapsed' | 'cancelled';
export type LaybyPaymentStatus = 'awaiting_payment' | 'paid' | 'failed' | 'abandoned' | 'review';
export type LaybyPaymentKind = 'deposit' | 'instalment';

export const LAYBY_PLAN_STATUSES: readonly LaybyPlanStatus[] = ['awaiting_deposit', 'active', 'paid', 'lapsed', 'cancelled'];

export interface LaybyConfig {
  /** Share of the order total paid first, in whole percent. */
  depositPercent: number;
  /** Days from the deposit by which the whole balance is due. */
  termDays: number;
  /** Kept from what was paid when a plan is cancelled or lapses, in whole percent of the amount paid. */
  cancellationFeePercent: number;
  /** Only orders whose goods total (after discounts, before delivery) reaches this. */
  minGoodsUgx: number;
  /** Days after the deposit on which a reminder is texted, ascending. */
  reminderDays: number[];
}

/** The owner's decisions of 2026-11-07, used whenever a setting is missing or unreadable. */
export const DEFAULT_LAYBY_CONFIG: Readonly<LaybyConfig> = Object.freeze({
  depositPercent: 30,
  termDays: 30,
  cancellationFeePercent: 10,
  minGoodsUgx: 100_000,
  reminderDays: [20, 27],
});

export interface LaybyConfigEntry {
  key: string;
  label: string;
  help: string;
  min: number;
  max: number;
}

/** The closed list of settings an operator may change. Values are stored as text. */
export const LAYBY_CONFIG_REGISTRY: readonly LaybyConfigEntry[] = [
  { key: 'layby_deposit_percent', label: 'Deposit, percent of the order total', help: 'Paid first, through Pesapal, to start the plan.', min: 1, max: 99 },
  { key: 'layby_term_days', label: 'Days to pay the balance', help: 'Counted from the day the deposit is paid.', min: 1, max: 180 },
  { key: 'layby_cancellation_fee_percent', label: 'Fee kept on cancellation or lapse, percent of the amount paid', help: 'The rest of what the customer paid is refunded by the team.', min: 0, max: 50 },
  { key: 'layby_min_goods_ugx', label: 'Smallest goods total that may be paid in parts (UGX)', help: 'Goods after discounts, before delivery.', min: 1_000, max: 100_000_000 },
  { key: 'layby_reminder_days', label: 'Reminder days after the deposit (comma separated)', help: 'One text on each of these days while a balance is left.', min: 1, max: 180 },
];

const intIn = (raw: unknown, min: number, max: number): number | null => {
  const n = Number(String(raw ?? '').trim());
  return String(raw ?? '').trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Reminder days from "20,27": whole days, inside the term, ascending, no repeats. Null when unreadable. */
export function parseReminderDays(raw: unknown, termDays: number): number[] | null {
  const parts = String(raw ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 5) return null;
  const days = parts.map((p) => intIn(p, 1, Math.max(1, termDays - 1)));
  if (days.some((d) => d === null)) return null;
  return [...new Set(days as number[])].sort((a, b) => a - b);
}

/** The settings as stored (key -> text), read with the owner's defaults for anything missing or out of range. */
export function laybyConfigFrom(values: Record<string, string | null | undefined>): LaybyConfig {
  const d = DEFAULT_LAYBY_CONFIG;
  const termDays = intIn(values.layby_term_days, 1, 180) ?? d.termDays;
  return {
    depositPercent: intIn(values.layby_deposit_percent, 1, 99) ?? d.depositPercent,
    termDays,
    cancellationFeePercent: intIn(values.layby_cancellation_fee_percent, 0, 50) ?? d.cancellationFeePercent,
    minGoodsUgx: intIn(values.layby_min_goods_ugx, 1_000, 100_000_000) ?? d.minGoodsUgx,
    reminderDays: parseReminderDays(values.layby_reminder_days, termDays) ?? d.reminderDays.filter((x) => x < termDays),
  };
}

/** Checks one setting an operator typed. */
export function checkLaybySetting(key: string, raw: unknown, current: LaybyConfig): { ok: true; value: string } | { ok: false; message: string } {
  const entry = LAYBY_CONFIG_REGISTRY.find((e) => e.key === key);
  if (!entry) return { ok: false, message: 'That is not a pay in parts setting.' };
  if (key === 'layby_reminder_days') {
    const days = parseReminderDays(raw, current.termDays);
    return days ? { ok: true, value: days.join(',') } : { ok: false, message: `Reminder days are whole days before day ${current.termDays}, separated by commas (for example 20,27).` };
  }
  const n = intIn(raw, entry.min, entry.max);
  return n === null ? { ok: false, message: `${entry.label}: a whole number from ${entry.min} to ${entry.max}.` } : { ok: true, value: String(n) };
}

export const DAY_MS = 86_400_000;

/** May this order be paid in parts? Goods after discounts, before delivery, at or above the minimum. */
export function isLaybyEligible(goodsUgx: number, cfg: LaybyConfig): boolean {
  return Number.isFinite(goodsUgx) && goodsUgx >= cfg.minGoodsUgx;
}

/** The deposit, in whole shillings, rounded up so the deposit is never below the stated percent. */
export function laybyDeposit(totalUgx: number, cfg: LaybyConfig): number {
  return Math.min(totalUgx, Math.ceil((totalUgx * cfg.depositPercent) / 100));
}

/** What the team refunds when a plan is cancelled or lapses: what was paid less the fee (a percent of what was paid). */
export function laybyRefund(paidUgx: number, cfg: Pick<LaybyConfig, 'cancellationFeePercent'>): { feeUgx: number; refundUgx: number } {
  const paid = Math.max(0, Math.round(paidUgx));
  const feeUgx = Math.round((paid * cfg.cancellationFeePercent) / 100);
  return { feeUgx, refundUgx: paid - feeUgx };
}

export function laybyDueAt(depositPaidAt: Date, cfg: Pick<LaybyConfig, 'termDays'>): Date {
  return new Date(depositPaidAt.getTime() + cfg.termDays * DAY_MS);
}

/** Smallest instalment the page accepts (unless the balance itself is smaller). */
export const LAYBY_MIN_INSTALMENT_UGX = 1_000;

/** Any whole amount from the minimum up to the balance; the balance itself is always allowed. */
export function checkInstalmentAmount(raw: unknown, balanceUgx: number): { ok: true; amountUgx: number } | { ok: false; message: string } {
  const n = Number(String(raw ?? '').replace(/[,\s]/g, ''));
  if (!Number.isInteger(n) || n <= 0) return { ok: false, message: 'Type an amount in shillings, for example 50000.' };
  if (n > balanceUgx) return { ok: false, message: `That is more than what is left to pay (UGX ${balanceUgx.toLocaleString('en-US')}).` };
  if (n < Math.min(LAYBY_MIN_INSTALMENT_UGX, balanceUgx)) return { ok: false, message: `The smallest payment is UGX ${LAYBY_MIN_INSTALMENT_UGX.toLocaleString('en-US')}.` };
  return { ok: true, amountUgx: n };
}

/** The reminder days now due for a plan (deposit paid `depositPaidAt`), not yet sent, while a balance is left. */
export function remindersDue(input: { status: LaybyPlanStatus; depositPaidAt: Date | null; sentDays: number[]; balanceUgx: number }, cfg: LaybyConfig, now: Date): number[] {
  if (input.status !== 'active' || !input.depositPaidAt || input.balanceUgx <= 0) return [];
  const elapsedDays = Math.floor((now.getTime() - input.depositPaidAt.getTime()) / DAY_MS);
  // Only the latest due day is sent: a plan that missed day 20 (the sweep was down) gets one text, not two at once.
  const due = cfg.reminderDays.filter((d) => d <= elapsedDays && !input.sentDays.includes(d));
  const latest = due.at(-1);
  return latest === undefined || cfg.reminderDays.some((d) => d > latest && input.sentDays.includes(d)) ? [] : [latest];
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A payment's own Pesapal merchant reference (never an order number): LB- and ten characters. */
export function laybyPaymentReference(randomIndexes: readonly number[]): string {
  if (randomIndexes.length < 10) throw new Error('laybyPaymentReference needs 10 random indexes');
  return `LB-${randomIndexes.slice(0, 10).map((n) => ALPHABET[((n % 32) + 32) % 32]).join('')}`;
}

export function isLaybyPaymentReference(value: unknown): value is string {
  return typeof value === 'string' && /^LB-[0-9A-HJKMNP-TV-Z]{10}$/.test(value);
}

/** "Friday 12 December", Kampala time. */
export function kampalaDayWords(at: Date): string {
  return at.toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', weekday: 'long', day: 'numeric', month: 'long' });
}
