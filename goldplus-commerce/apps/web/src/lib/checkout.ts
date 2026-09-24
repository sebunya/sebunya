import { createHmac } from 'node:crypto';
import type { CartItem } from './cart';

export interface CustomerDetails {
  name: string;
  email?: string;
  phone: string;
  deliveryArea: string;
  deliveryAddress: string;
}

export interface CheckoutPayload {
  customerDetails: CustomerDetails & { deliveryLocation?: StructuredDeliveryLocation | null };
  buyerType: string;
  /**
   * Slice 3B: the server prices every line from the catalogue. Only
   * productId and quantity are sent — client-side prices are never trusted.
   */
  items: {
    productId: string;
    quantity: number;
  }[];
  /** Idempotency key so a resubmitted form cannot create a duplicate order. */
  clientOrderKey?: string;
}

export interface StructuredDeliveryLocation {
  district: string;
  region?: string;
  countyOrMunicipality?: string;
  subcountyDivisionTc?: string;
  parishWard?: string;
  postcode?: string;
  displayLabel?: string;
  /** Location module (PART G): structured area link + optional customer pin. */
  areaSlug?: string;
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracyM?: number;
  gpsSource?: 'device' | 'pasted_link';
}

export function validateCheckoutPayload(payload: Partial<CheckoutPayload>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload.customerDetails?.name?.trim()) {
    errors.push('Name is required');
  }
  if (!payload.customerDetails?.phone?.trim()) {
    errors.push('Phone is required');
  }
  if (!payload.customerDetails?.deliveryArea?.trim()) {
    errors.push('Delivery area is required');
  }
  if (!payload.customerDetails?.deliveryAddress?.trim()) {
    errors.push('Delivery address is required');
  }
  if (!payload.buyerType?.trim()) {
    errors.push('Buyer type is required');
  }
  if (!payload.items || payload.items.length === 0) {
    errors.push('Cart is empty');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function prepareCheckoutPayload(formData: FormData, cartItems: CartItem[]): CheckoutPayload {
  const locationJson = String(formData.get('locationJson') ?? '');
  let deliveryArea = '';
  let deliveryAddress = '';
  let deliveryLocation: StructuredDeliveryLocation | null = null;

  if (locationJson.startsWith('{')) {
    try {
      const loc = JSON.parse(locationJson);

      // Manual PART H path (picker v2): { manual: true, rawAddressText,
      // district? }. The sale never blocks on a data gap — free text proceeds
      // with the fee honestly unconfirmed; a canonical district still rides
      // along when the customer picked one.
      if (loc.manual && loc.rawAddressText) {
        const manualDistrict = loc.district ? String(loc.district).trim() : '';
        deliveryArea = manualDistrict ? `${String(loc.rawAddressText).slice(0, 200)}, ${manualDistrict}` : String(loc.rawAddressText).slice(0, 255);
        const rawDetails = String(formData.get('deliveryAddress') || '').trim();
        deliveryAddress = rawDetails || deliveryArea;
        deliveryLocation = manualDistrict ? { district: manualDistrict, displayLabel: deliveryArea.slice(0, 200) } : null;
        return {
          customerDetails: {
            name: (formData.get('name') as string) || '',
            email: (formData.get('email') as string) || undefined,
            phone: (formData.get('phone') as string) || '',
            deliveryArea,
            deliveryAddress,
            deliveryLocation,
          },
          buyerType: (formData.get('buyerType') as string) || 'retail',
          items: cartItems.map(item => ({
            productId: item.productId,
            quantity: Number(item.quantity) || 1
          }))
        };
      }

      // Lean picker shape (2026 rework): { district, area?, displayLabel } +
      // optional pin fields from PART G.1 capture.
      // The structured layer stops at the verified district + known area; the
      // fine detail is the customer's own free-text address line. Checked
      // FIRST so the legacy gazetteer parsing below never mangles it.
      if (loc.district && !loc.parishWard && !loc.parish) {
        const district = String(loc.district).trim();
        const area = loc.area ? String(loc.area).trim() : '';
        deliveryArea = area ? `${area}, ${district}` : district;
        const rawDetails = String(formData.get('deliveryAddress') || '').trim();
        deliveryAddress = rawDetails || deliveryArea;
        deliveryLocation = {
          district,
          displayLabel: loc.displayLabel ? String(loc.displayLabel) : deliveryArea,
          ...(loc.areaSlug ? { areaSlug: String(loc.areaSlug) } : {}),
          ...(typeof loc.gpsLat === 'number' && typeof loc.gpsLng === 'number'
            ? {
                gpsLat: loc.gpsLat,
                gpsLng: loc.gpsLng,
                ...(typeof loc.gpsAccuracyM === 'number' ? { gpsAccuracyM: loc.gpsAccuracyM } : {}),
                ...(loc.gpsSource === 'device' || loc.gpsSource === 'pasted_link' ? { gpsSource: loc.gpsSource } : {}),
              }
            : {}),
        };
        return {
          customerDetails: {
            name: (formData.get('name') as string) || '',
            email: (formData.get('email') as string) || undefined,
            phone: (formData.get('phone') as string) || '',
            deliveryArea,
            deliveryAddress,
            deliveryLocation,
          },
          buyerType: (formData.get('buyerType') as string) || 'retail',
          items: cartItems.map(item => ({
            productId: item.productId,
            quantity: Number(item.quantity) || 1
          })),
          clientOrderKey: String(formData.get('clientOrderKey') || '').trim() || undefined
        };
      }

      // Composed from the parts that are actually PRESENT.
      //
      // Both strings were built by interpolating optional fields directly, so a
      // location without a parish, a region or a postcode produced literal
      // "undefined" in the address — `undefined | undefined, Kampala` and
      // `Plot 1 | undefined · Postcode undefined`. That string is what the
      // delivery driver reads and what the admin sees on the order, and only the
      // district is guaranteed for a Uganda location. Found by the end-to-end
      // harness: typecheck and every component test passed, because `${undefined}`
      // is a valid string.
      const present = (...parts: unknown[]) =>
        parts
          .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
          .filter(Boolean);

      const areaParts = present(loc.parishWard || loc.parish, loc.subcountyDivisionTc || loc.subcounty);
      const district = present(loc.district).join('');
      deliveryArea = areaParts.length > 0
        ? `${areaParts.join(' | ')}${district ? `, ${district}` : ''}`
        : district;

      const rawDetails = String(formData.get('deliveryAddress') || '').trim();
      const postcode = present(loc.postcode).join('');
      const adminDetails = present(
        loc.countyOrMunicipality || loc.county,
        loc.region,
        postcode ? `Postcode ${postcode}` : '',
      ).join(' · ');
      deliveryAddress = [rawDetails, adminDetails].filter(Boolean).join(' | ');
      if (loc.district) {
        deliveryLocation = {
          district: String(loc.district),
          region: loc.region ? String(loc.region) : undefined,
          countyOrMunicipality: loc.countyOrMunicipality || loc.county ? String(loc.countyOrMunicipality || loc.county) : undefined,
          subcountyDivisionTc: loc.subcountyDivisionTc || loc.subcounty ? String(loc.subcountyDivisionTc || loc.subcounty) : undefined,
          parishWard: loc.parishWard || loc.parish ? String(loc.parishWard || loc.parish) : undefined,
          postcode: loc.postcode ? String(loc.postcode) : undefined,
          displayLabel: loc.displayLabel ? String(loc.displayLabel) : undefined,
        };
      }
    } catch (e) {
      // fallback to whatever raw text was submitted if JSON decode exploded
      deliveryArea = String(formData.get('deliveryArea') || '');
      deliveryAddress = String(formData.get('deliveryAddress') || '');
    }
  } else {
    // Pure fallback if legacy form is running
    deliveryArea = String(formData.get('deliveryArea') || formData.get('location') || '');
    deliveryAddress = String(formData.get('deliveryAddress') || deliveryArea || '');
  }

  return {
    customerDetails: {
      name: (formData.get('name') as string) || '',
      email: (formData.get('email') as string) || undefined,
      phone: (formData.get('phone') as string) || '',
      deliveryArea: deliveryArea.trim(),
      deliveryAddress: deliveryAddress.trim(),
      deliveryLocation,
    },
    buyerType: (formData.get('buyerType') as string) || 'retail',
    items: cartItems.map(item => ({
      productId: item.productId,
      quantity: Number(item.quantity) || 1
    })),
    clientOrderKey: String(formData.get('clientOrderKey') || '').trim() || undefined
  };
}

// ---------------------------------------------------------------------------
// Contact checks the storefront makes BEFORE the order is sent.
//
// The API only asked for 5–20 characters of phone, so '12345' or a number with
// a digit missing created a real order that nobody could call back — on a
// pay-on-delivery store whose next step is "our team will call you".
// ---------------------------------------------------------------------------

/** Ugandan fixed lines: 02…, 03… or 04… then eight digits (0414 123 456). */
export const UG_FIXED_LINE = /^0[2-4]\d{8}$/;

/**
 * A reachable phone number, or null. Ugandan mobiles (MTN, Airtel and the rest
 * all start 07) are accepted as 07XXXXXXXX, 7XXXXXXXX, 2567XXXXXXXX or
 * +256 7XX XXX XXX, with any spaces, dashes, dots or brackets. Ugandan fixed
 * lines (0414 123 456, 0392 …, +256 414 …: 02, 03 and 04 then eight digits)
 * are accepted too: the rider only needs a number that answers, and before
 * this check existed the API took them, so an office ordering on its desk
 * line was refused for no reason. A number written with a non-Ugandan country
 * code (+254…, 00 44…) is accepted as international so a relative abroad can
 * still order. Returned normalised: 0772123456, 0414123456 or +254….
 *
 * /register stays mobile-only on purpose: an account's number receives SMS
 * codes (verification, password reset), which a fixed line cannot.
 */
export function normaliseCheckoutPhone(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let digits = s.replace(/[\s\-().]/g, '');
  let international = false;
  if (digits.startsWith('+')) { international = true; digits = digits.slice(1); }
  else if (digits.startsWith('00')) { international = true; digits = digits.slice(2); }
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('256')) {
    const local = digits.slice(3).replace(/^0/, '');
    return /^[2-47]\d{8}$/.test(local) ? `0${local}` : null;
  }
  if (!international && /^07\d{8}$/.test(digits)) return digits;
  if (!international && UG_FIXED_LINE.test(digits)) return digits;
  if (!international && /^7\d{8}$/.test(digits)) return `0${digits}`;
  if (international && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export const PHONE_FORMAT_MESSAGE =
  'Enter a number we can call, for example 0772 123 456 or 0414 123 456 (10 digits), or +256 772 123 456.';

/** A deliberately loose shape check: something@something.tld, no spaces. */
export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw ?? '').trim());
}

export const EMAIL_FORMAT_MESSAGE = 'Enter a full email address, like name@example.com, or leave it empty.';

// ---------------------------------------------------------------------------
// The same-day line beside the order button.
//
// It used to say "Order in 3h 5m and this arrives today" to everyone, worked
// out with no location at all, so a customer who had just chosen Arua (about
// 500 km away) read a same-day promise at the moment of commitment while the
// footer said "Same-day in Kampala & Wakiso". A promise that is not true for
// this customer is fake urgency, however accurate the clock.
// ---------------------------------------------------------------------------

/** The districts the storefront already names as same-day everywhere else. */
export const SAME_DAY_DISTRICTS = ['Kampala', 'Wakiso'] as const;
const SAME_DAY_AREA_LABEL = 'Kampala & Wakiso';

export function isSameDayDistrict(district: string | null | undefined): boolean {
  const d = String(district ?? '').trim().toLowerCase();
  return SAME_DAY_DISTRICTS.some((s) => s.toLowerCase() === d);
}

export interface CutoffState {
  closed: boolean;
  beforeCutoff: boolean;
  minsToCutoff: number;
}

export interface SameDayCopy {
  /** No district chosen yet: the promise names where it applies. */
  scoped: string;
  /** The chosen district is a same-day district. */
  inArea: string;
  /** Anywhere else: no same-day promise at all. */
  outside: string;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * The next day the shop dispatches, named. "Tomorrow" only when tomorrow is
 * open: after Saturday's cutoff with Sunday closed, "this goes out tomorrow
 * morning" was false. Null when the caller gave no calendar (the old wording
 * is then kept, generic and true).
 */
export function nextDispatchDayLabel(now: Date | undefined, closedDays: readonly number[] | undefined): string | null {
  if (!now || !Array.isArray(closedDays)) return null;
  const today = new Date(now.getTime() + 3 * 60 * 60 * 1000).getUTCDay(); // EAT, UTC+3, no DST
  for (let d = 1; d <= 7; d += 1) {
    const day = (today + d) % 7;
    if (!closedDays.includes(day)) return d === 1 ? 'tomorrow' : `on ${WEEKDAY_NAMES[day]}`;
  }
  return null; // every day closed: name nothing rather than guess
}

export function sameDayCutoffCopy(
  cut: CutoffState,
  calendar?: { now?: Date; closedDays?: readonly number[] },
): SameDayCopy {
  const next = nextDispatchDayLabel(calendar?.now, calendar?.closedDays);
  if (cut.closed) {
    const s = next ? `Closed today. This goes out ${next} morning` : 'Closed today. This goes out on the next working day';
    return { scoped: s, inArea: s, outside: s };
  }
  if (!cut.beforeCutoff) {
    const s = next
      ? `Today's run has left. This goes out ${next} morning`
      : "Today's run has left. This goes out on the next working day";
    return { scoped: s, inArea: s, outside: s };
  }
  const outside = `Same-day delivery is for ${SAME_DAY_AREA_LABEL}. We confirm your delivery day by phone`;
  if (cut.minsToCutoff <= 60) {
    return {
      scoped: `${SAME_DAY_AREA_LABEL}: only ${cut.minsToCutoff} minutes left for same-day delivery`,
      // When it goes OUT, never when it arrives: no area has observed data
      // behind a same-day arrival (delivery contract #10).
      inArea: `Only ${cut.minsToCutoff} minutes left for this to go out today`,
      outside,
    };
  }
  const h = Math.floor(cut.minsToCutoff / 60);
  const m = cut.minsToCutoff % 60;
  return {
    scoped: `${SAME_DAY_AREA_LABEL}: order in ${h}h ${m}m for same-day delivery`,
    inArea: `Order in ${h}h ${m}m and this goes out today`,
    outside,
  };
}

/** Which of the three lines is true for this district (null = not chosen yet). */
export function sameDayLineFor(copy: SameDayCopy, district: string | null | undefined): string {
  if (!district || !String(district).trim()) return copy.scoped;
  return isSameDayDistrict(district) ? copy.inArea : copy.outside;
}

// ---------------------------------------------------------------------------
// The order receipt behind the confirmation page.
//
// The confirmation used to be rendered in the POST response itself. The basket
// is cleared once the order exists, so a refresh re-POSTed into the empty-cart
// redirect and the customer landed on "Your cart is empty" with the order
// number gone. The page now redirects (Post/Redirect/Get) to
// /checkout/confirmed, and what that page shows travels in a short-lived,
// HMAC-sealed, httpOnly cookie: never in the URL, and never trusted unsigned.
// ---------------------------------------------------------------------------

export const ORDER_RECEIPT_COOKIE = 'gp_order_receipt';
export const ORDER_RECEIPT_PATH = '/checkout/confirmed';
export const ORDER_RECEIPT_MAX_AGE_SECONDS = 60 * 60;
/** Order numbers look like GP-202609-8A776429 (four characters before 2026-08-28). */
export const ORDER_NUMBER_PATTERN = /^GP-\d{6}-[A-Z0-9]{4,8}$/;
/** What a receipt may name: an order number, or the order id when no number came back. */
const RECEIPT_REF_PATTERN = /^(?:GP-\d{6}-[A-Z0-9]{4,8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface OrderReceipt {
  v: 1;
  /** The customer-facing order number. */
  ref: string;
  orderId: string | null;
  message: string;
  actionLabel: string;
  /**
   * What was ordered, by name and quantity only. No per-line price: the page
   * only knows the basket's list price, which ignores the sale price, promo
   * code and points already in the server's total.
   */
  items: Array<{ name: string; quantity: number }>;
  /** The server's figure when it gave one; null when this page never saw it. */
  totalUgx: number | null;
  deliveryFeeConfirmed: boolean | null;
  deliveryPlace: string;
  phoneMasked: string;
  /** Epoch ms, so an old cookie is refused even if the browser kept it. */
  issuedAt: number;
}

export type ReceiptSigner = (data: string) => string;

/** 0772 123 456 → •••• ••• 456. Enough to spot a typo, not enough to leak. */
export function maskPhone(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `•••• ••• ${digits.slice(-3)}`;
}

function toBase64Url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function fromBase64Url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

/** Bounded so the cookie always fits (a browser drops a cookie over ~4 KB). */
export function sealOrderReceipt(receipt: OrderReceipt, sign: ReceiptSigner): string {
  const bounded: OrderReceipt = {
    ...receipt,
    message: receipt.message.slice(0, 400),
    actionLabel: receipt.actionLabel.slice(0, 60),
    deliveryPlace: receipt.deliveryPlace.slice(0, 160),
    items: receipt.items.slice(0, 12).map((i) => ({
      name: String(i.name).slice(0, 80),
      quantity: Math.max(1, Math.trunc(Number(i.quantity) || 1)),
    })),
  };
  const body = toBase64Url(JSON.stringify(bounded));
  return `${body}.${sign(body)}`;
}

export function openOrderReceipt(
  value: string | undefined | null,
  sign: ReceiptSigner,
  nowMs: number,
): OrderReceipt | null {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = sign(body);
  // Constant-time enough for a same-length base64url MAC compare.
  if (mac.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const r = JSON.parse(fromBase64Url(body)) as OrderReceipt;
    if (r?.v !== 1 || typeof r.ref !== 'string' || !RECEIPT_REF_PATTERN.test(r.ref)) return null;
    if (typeof r.issuedAt !== 'number' || nowMs - r.issuedAt > ORDER_RECEIPT_MAX_AGE_SECONDS * 1000 || r.issuedAt > nowMs + 60_000) return null;
    if (!Array.isArray(r.items)) return null;
    return r;
  } catch {
    return null;
  }
}

/**
 * The receipt signer, keyed from the SAME secret as the checkout intent (the
 * page cannot take an order without it), under its own label so a receipt MAC
 * can never be replayed as anything else. Null only when no secret is set.
 */
export function orderReceiptSigner(env: Record<string, string | undefined>): ReceiptSigner | null {
  const root = (env.CHECKOUT_INTENT_SECRET || env.JWT_SECRET || '').trim();
  if (!root) return null;
  return (data: string) => createHmac('sha256', root).update(`gp-order-receipt:v1:${data}`).digest('base64url');
}
