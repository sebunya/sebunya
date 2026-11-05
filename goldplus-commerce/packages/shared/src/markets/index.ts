/**
 * Markets: the countries GoldPlus sells in (owner 2026-11-05: Kenya is next). One record per country holds what used
 * to be hard-coded to Uganda across the codebase: currency, phone shape, dialling code, locale, timezone, tax label.
 * Uganda is live. Kenya and Rwanda are configured but NOT live: each switches on only when the owner has the things
 * listed in docs/markets/KENYA.md and docs/markets/RWANDA.md (local prices, a local payment account, a delivery partner,
 * tax registration).
 *
 * New code reads a market from here instead of typing 'UGX', '+256' or 'Africa/Kampala'. Existing Uganda-only helpers
 * (normalizeUgandanPhone, formatUgx, EAT) stay and are now the Uganda case of these.
 */
export type MarketCode = 'UG' | 'KE' | 'RW';
export type CurrencyCode = 'UGX' | 'KES' | 'RWF';

export interface Market {
  code: MarketCode;
  name: string;
  live: boolean;
  currency: CurrencyCode;
  /** Minor units shown to shoppers: 0 for both (UGX has none; Kenyan shops price whole shillings). */
  currencyDecimals: number;
  dialCode: string;
  /** The national significant number after the trunk 0: 9 digits in both countries. */
  nationalShape: RegExp;
  locale: string;
  timezone: string;
  /** VAT rate as a whole percent, for display only; tax is computed where orders are priced. */
  vatPercent: number;
  taxAuthority: string;
  mobileMoney: readonly string[];
}

export const MARKETS: Readonly<Record<MarketCode, Market>> = {
  UG: {
    code: 'UG', name: 'Uganda', live: true, currency: 'UGX', currencyDecimals: 0, dialCode: '256',
    nationalShape: /^\d{9}$/, locale: 'en-UG', timezone: 'Africa/Kampala', vatPercent: 18, taxAuthority: 'URA',
    mobileMoney: ['MTN MoMo', 'Airtel Money'],
  },
  KE: {
    // Kenya: mobile numbers start 07 or 01 (Safaricom, Airtel, Telkom); same UTC+03:00 as Kampala, no DST.
    code: 'KE', name: 'Kenya', live: false, currency: 'KES', currencyDecimals: 0, dialCode: '254',
    nationalShape: /^[17]\d{8}$/, locale: 'en-KE', timezone: 'Africa/Nairobi', vatPercent: 16, taxAuthority: 'KRA',
    mobileMoney: ['M-Pesa', 'Airtel Money'],
  },
  RW: {
    // Rwanda: mobile numbers 072/073 (Airtel) and 078/079 (MTN). Kigali is UTC+02:00 (CAT), ONE HOUR BEHIND Kampala:
    // the EAT time module is NOT correct for Rwanda (cut-offs, delivery windows); see docs/markets/RWANDA.md.
    code: 'RW', name: 'Rwanda', live: false, currency: 'RWF', currencyDecimals: 0, dialCode: '250',
    nationalShape: /^7[2389]\d{7}$/, locale: 'en-RW', timezone: 'Africa/Kigali', vatPercent: 18, taxAuthority: 'RRA',
    mobileMoney: ['MTN MoMo', 'Airtel Money'],
  },
};

/** UTC offset in minutes per market (none of the three observes daylight saving). */
export const MARKET_UTC_OFFSET_MINUTES: Readonly<Record<MarketCode, number>> = { UG: 180, KE: 180, RW: 120 };

export const HOME_MARKET: MarketCode = 'UG';
export const LIVE_MARKETS: readonly Market[] = Object.values(MARKETS).filter((m) => m.live);

export function marketFor(code: string | null | undefined): Market {
  return (code && (MARKETS as Record<string, Market>)[code.toUpperCase()]) || MARKETS[HOME_MARKET];
}

/** Normalise a phone number for a market to E.164: accepts 0XXXXXXXXX, +CCCXXXXXXXXX, CCCXXXXXXXXX with spaces or hyphens. */
export function normalizeMarketPhone(raw: string | null | undefined, market: Market = MARKETS[HOME_MARKET]): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s\-().]/g, '');
  const cc = market.dialCode;
  let national: string | null = null;
  if (digits.startsWith(`+${cc}`)) national = digits.slice(cc.length + 1);
  else if (digits.startsWith(cc) && digits.length === cc.length + 9) national = digits.slice(cc.length);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  if (!national || !market.nationalShape.test(national)) return null;
  return `+${cc}${national}`;
}

/** Which live market a phone number belongs to, by its dialling code; null for a bare national number. */
export function marketForPhone(raw: string | null | undefined): Market | null {
  const digits = (raw ?? '').replace(/[\s\-().]/g, '').replace(/^\+/, '');
  return Object.values(MARKETS).find((m) => digits.startsWith(m.dialCode) && digits.length === m.dialCode.length + 9) ?? null;
}

/** "UGX 45,000" / "KES 1,250": the ISO code, a non-breaking space, grouped digits. The code, never a locale symbol. */
export function formatMoney(value: unknown, currency: CurrencyCode = 'UGX'): string {
  const decimals = Object.values(MARKETS).find((m) => m.currency === currency)?.currencyDecimals ?? 0;
  const n = Number(value) || 0;
  return `${currency}\u00A0${new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(decimals === 0 ? Math.round(n) : n)}`;
}
