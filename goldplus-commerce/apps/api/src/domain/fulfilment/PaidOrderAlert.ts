import { isCollectionAreaLine } from '../locations/GreaterKampala';

/**
 * The SMS the shop's own fulfilment phone gets when an order is paid (0143), written so the person reading it can
 * act without opening anything: what to pack, where it goes, who to call, whether delivery was charged, and a link
 * to the order.
 *
 * It used to say only "order GP-… is PAID (UGX 110,000) for <area>. Prepare it for delivery." With a typed-in place
 * the "area" was the customer's own sentence, so staff learnt neither the item nor the customer's number (owner,
 * 2026-10-21). It goes only to the shop's configured fulfilment numbers, never to a customer; an erasure removes
 * the customer's details from the stored event (customerName, customerPhone, deliveryPlace).
 *
 * Pure. Stays in the GSM-7 alphabet (one character outside it makes the whole text UCS-2, a third of the length per
 * part), so the customer's words are folded to plain characters.
 */
export interface PaidOrderAlertInput {
  orderNumber: string;
  totalUgx: number;
  deliveryFeeUgx: number;
  items: Array<{ name: string; sku: string; quantity: number }>;
  customerName: string;
  customerPhone: string;
  /** The order's area line and address, and the structured label when there is one. */
  deliveryArea: string;
  deliveryAddress: string;
  placeLabel?: string | null;
  /** A map link when the customer pinned or picked the place. */
  mapUrl?: string | null;
  /** Gift card / store credit part, when any (the rest came by Mobile Money or card). */
  storeCreditUgx?: number;
  orderUrl: string;
}

const GSM = "@£$¥èéùìòÇ\nØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** Fold a customer's words into plain GSM characters: curly quotes and dashes become plain ones, the rest goes. */
export function gsmPlain(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/…/g, '...')
    .split('')
    .filter((c) => GSM.includes(c))
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-US')}`;
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 3).trimEnd()}...`);

export function paidOrderAlertText(i: PaidOrderAlertInput): string {
  const collect = isCollectionAreaLine(i.deliveryArea);
  const lines: string[] = [];
  lines.push(`GoldPlus PAID ${i.orderNumber} ${ugx(i.totalUgx)}${i.storeCreditUgx ? ` (gift card ${ugx(i.storeCreditUgx)})` : ''}`);
  const shown = i.items.slice(0, 3);
  for (const it of shown) lines.push(`${it.quantity}x ${cut(gsmPlain(it.name), 48)}${it.sku ? ` [${gsmPlain(it.sku)}]` : ''}`);
  if (i.items.length > shown.length) lines.push(`+${i.items.length - shown.length} more item(s)`);
  // The place once: the structured label first, then the customer's own words when they add anything.
  const parts = [i.placeLabel, i.deliveryArea, i.deliveryAddress].map((p) => gsmPlain(String(p ?? ''))).filter(Boolean);
  const place = [...new Set(parts)].filter((p, idx, all) => !all.some((o, j) => j !== idx && o.length > p.length && o.toLowerCase().includes(p.toLowerCase())));
  lines.push(`${collect ? 'Collect' : 'Deliver'}: ${cut(place.join(', ') || 'no place given - call the customer', 120)}`);
  lines.push(`Customer: ${cut(gsmPlain(i.customerName), 40)} ${i.customerPhone.replace(/\s+/g, '')}`);
  if (!collect && i.deliveryFeeUgx <= 0) lines.push('Delivery NOT charged: agree the fee with the customer before dispatch.');
  if (i.mapUrl) lines.push(`Map: ${i.mapUrl}`);
  lines.push(`Open: ${i.orderUrl}`);
  return lines.join('\n');
}

/** A map link for the order's pinned or picked place, or null. */
export function deliveryMapUrl(loc: { gpsLat?: number; gpsLng?: number; placeId?: string } | null | undefined): string | null {
  if (!loc) return null;
  if (typeof loc.gpsLat === 'number' && typeof loc.gpsLng === 'number' && Number.isFinite(loc.gpsLat) && Number.isFinite(loc.gpsLng)) {
    return `https://maps.google.com/?q=${loc.gpsLat.toFixed(6)},${loc.gpsLng.toFixed(6)}`;
  }
  if (loc.placeId && /^[A-Za-z0-9_-]{10,}$/.test(loc.placeId)) return `https://www.google.com/maps/place/?q=place_id:${loc.placeId}`;
  return null;
}
