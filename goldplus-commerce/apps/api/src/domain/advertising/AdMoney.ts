import type { CanonicalTelemetryEvent } from '@goldplus/shared';

/**
 * Ad platforms receive money in US dollars only (owner decision 2026-10-06).
 * Customers still see and pay in Uganda shillings; this converts at the one
 * rate the owner set on the Advertising page (ad_settings.ugx_per_usd, 0172).
 *
 * With no valid rate, money is REMOVED, never sent in shillings: the event
 * still counts, without an amount. A non-UGX amount (none exist today) is
 * removed too rather than guessed at.
 */
export const MIN_UGX_PER_USD = 100;

export const validRate = (rate: number | null | undefined): rate is number =>
  typeof rate === 'number' && Number.isFinite(rate) && rate >= MIN_UGX_PER_USD;

/** A shilling amount in US dollars, to the cent; null when it cannot be stated. */
export function ugxToUsd(amountUgx: number | null | undefined, rate: number | null | undefined): number | null {
  if (typeof amountUgx !== 'number' || !Number.isFinite(amountUgx) || amountUgx < 0 || !validRate(rate)) return null;
  return Math.round((amountUgx / rate) * 100) / 100;
}

/** The event as every ad platform receives it: currency USD, value and item prices converted, or no money at all. */
export function eventInUsd(event: CanonicalTelemetryEvent, rate: number | null | undefined): CanonicalTelemetryEvent {
  const ec = event.ecommerce;
  if (!ec) return event;
  const from = (ec.currency ?? 'UGX').toUpperCase();
  const convert = (v: number | undefined) => (typeof v !== 'number' ? undefined : from === 'USD' ? v : from === 'UGX' ? (ugxToUsd(v, rate) ?? undefined) : undefined);
  const value = convert(ec.value);
  const items = Array.isArray(ec.items) ? ec.items.map((i) => {
    const { price, ...rest } = i as typeof i & { price?: number };
    const p = convert(price);
    return p === undefined ? rest : { ...rest, price: p };
  }) : ec.items;
  const { value: _v, currency: _c, ...restEc } = ec as typeof ec & { value?: number; currency?: string };
  const hasMoney = value !== undefined;
  return { ...event, ecommerce: { ...restEc, items, ...(hasMoney ? { value, currency: 'USD' } : {}) } as typeof ec };
}
