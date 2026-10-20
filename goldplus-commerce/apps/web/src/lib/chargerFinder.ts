import type { ProductPublicDto } from '@goldplus/shared';

/**
 * Charger and cable finder (gap analysis #12, 2026-10-20). Matches the shopper's device port, device and need
 * against VERIFIED specifications only (Connector, Ports, Built-in cables, Works with, In the box, Output power,
 * Fast charging). Every match carries the specification that made it fit, quoted, so nothing is claimed that staff
 * have not checked. A product whose checked specs say nothing about the port is left out rather than guessed in.
 */
export type DevicePort = 'usb-c' | 'lightning' | 'micro-usb';
export type DeviceKind = 'phone' | 'laptop';
export type ChargerNeed = 'wall' | 'car' | 'powerbank' | 'cable';

export const PORT_LABEL: Record<DevicePort, string> = { 'usb-c': 'USB-C', lightning: 'Lightning (iPhone)', 'micro-usb': 'Micro-USB (V8)' };
export const NEED_LABEL: Record<ChargerNeed, string> = { wall: 'Wall charger', car: 'Car charger', powerbank: 'Power bank', cable: 'Cable' };
export const LAPTOP_WATTS = [30, 45, 65] as const;

export interface FinderQuery { device: DeviceKind; port: DevicePort; need: ChargerNeed; watts: number | null }
export interface FinderMatch { product: ProductPublicDto; reasons: string[]; caveat: string | null; watts: number | null }

const PORT_WORDS: Record<DevicePort, RegExp> = {
  'usb-c': /usb-c|type-c/i,
  lightning: /lightning|iphone/i,
  'micro-usb': /micro-usb|\bv8\b/i,
};

function specs(p: ProductPublicDto): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of p.attributeValues ?? []) {
    if (a.isVerified && String(a.value).trim()) out[a.name] = `${String(a.value).trim()}${a.unit ? ` ${a.unit}` : ''}`;
  }
  return out;
}

export function productKind(p: ProductPublicDto): ChargerNeed | null {
  const n = p.name.toLowerCase();
  if (/car charger/.test(n) || p.categoryName === 'Car Accessories') return /charger/.test(n) ? 'car' : null;
  if (/power bank/.test(n)) return 'powerbank';
  if (/\bcable\b/.test(n) && !/charger/.test(n)) return 'cable';
  if (/charger/.test(n)) return 'wall';
  return null;
}

/** The device end of a cable: the last named connector ("USB-A to Micro-USB" -> Micro-USB). */
function cableDeviceEnd(connector: string): string {
  const parts = connector.split(/\bto\b/i);
  return parts.at(-1)!.trim();
}

/** Watts one USB-C port gives: a per-port figure when the Ports spec names one ("USB-C (PD 30W)"), else the total. */
function usbcWatts(s: Record<string, string>): { watts: number | null; shared: boolean } {
  const perPort = /usb-c[^+]*?(\d+(?:\.\d+)?)\s*w/i.exec(s.Ports ?? '');
  if (perPort) return { watts: Number(perPort[1]), shared: false };
  const total = Number.parseFloat(s['Output power'] ?? '');
  if (!Number.isFinite(total)) return { watts: null, shared: false };
  const ports = (s.Ports ?? '').split('+').length;
  return { watts: total, shared: ports > 1 };
}

export function matchCharger(p: ProductPublicDto, q: FinderQuery): FinderMatch | null {
  const kind = productKind(p);
  if (kind !== q.need) return null;
  const s = specs(p);
  const re = PORT_WORDS[q.port];
  const reasons: string[] = [];
  let caveat: string | null = null;

  if (kind === 'cable') {
    const end = s.Connector ? cableDeviceEnd(s.Connector) : '';
    if (end && re.test(end)) reasons.push(`Connector: ${s.Connector}`);
    else if (s['Works with'] && re.test(s['Works with'])) reasons.push(`Works with: ${s['Works with']}`);
    else return null;
  } else if (kind === 'powerbank') {
    if (s['Built-in cables'] && re.test(s['Built-in cables'])) reasons.push(`Built-in cables: ${s['Built-in cables']}`);
    else return null;
  } else {
    // Wall and car chargers: a charger serves the device through a cable. Say which cable is in the box when the
    // box has the right one; otherwise the charger fits only if its port is one a cable for this device plugs into.
    const boxCable = /([\w-]+(?:\s*\([^)]*\))?)\s+to\s+([\w-]+(?:\s*\([^)]*\))?)\s+cable/i.exec(s['In the box'] ?? '');
    if (boxCable && re.test(boxCable[2])) reasons.push(`In the box: ${s['In the box']}`);
    else if (s.Ports) {
      reasons.push(`Ports: ${s.Ports}`);
      const hasA = /usb-a/i.test(s.Ports);
      const hasC = /usb-c/i.test(s.Ports);
      const deviceEnd = PORT_LABEL[q.port].replace(' (iPhone)', '');
      const from = hasA && hasC ? 'USB-A or USB-C' : hasC ? 'USB-C' : 'USB-A';
      caveat = from === 'USB-C' && q.port === 'usb-c'
        ? 'Use it with a USB-C to USB-C cable (not in the box).'
        : `Use it with a ${from} to ${deviceEnd} cable (not in the box).`;
    } else if (s['Works with']) {
      reasons.push(`Works with: ${s['Works with']}`);
      caveat = `Use it with a ${PORT_LABEL[q.port]} cable.`;
    } else return null;
  }

  let watts: number | null = null;
  if (q.device === 'laptop') {
    // A laptop charges over USB-C Power Delivery only: the product must give USB-C, and enough watts.
    if (q.port !== 'usb-c') return null;
    const w = kind === 'cable'
      ? { watts: Number.parseFloat(s['Output power'] ?? ''), shared: false }
      : usbcWatts(s);
    if (!w.watts || !Number.isFinite(w.watts) || (q.watts !== null && w.watts < q.watts)) return null;
    if (kind !== 'cable' && !/usb-c/i.test(`${s.Ports ?? ''} ${s['Built-in cables'] ?? ''}`)) return null;
    watts = w.watts;
    reasons.push(`Output power: ${w.watts} W${w.shared ? ' (shared between its ports)' : ''}`);
    if (w.shared) caveat = `${w.watts} W is the charger's total across its ports. What one USB-C port gives on its own is not on our checked specification, so ask us if your laptop needs the full ${w.watts} W.`;
  } else if (s['Fast charging']) {
    reasons.push(`Fast charging: ${s['Fast charging']}`);
  }
  return { product: p, reasons, caveat, watts };
}

export function findChargers(products: ProductPublicDto[], q: FinderQuery): FinderMatch[] {
  return products
    .map((p) => matchCharger(p, q))
    .filter((m): m is FinderMatch => m !== null)
    // Ready to use first (the right cable is in the box, or nothing else is needed), then more power, then price.
    .sort((a, b) => Number(a.caveat !== null) - Number(b.caveat !== null) || (b.watts ?? 0) - (a.watts ?? 0) || (a.product.retailPriceUgx ?? 0) - (b.product.retailPriceUgx ?? 0));
}

export function parseFinderQuery(params: URLSearchParams): FinderQuery | null {
  const device = params.get('device') === 'laptop' ? 'laptop' : params.get('device') === 'phone' ? 'phone' : null;
  const port = (['usb-c', 'lightning', 'micro-usb'] as const).find((v) => v === params.get('port')) ?? null;
  const need = (['wall', 'car', 'powerbank', 'cable'] as const).find((v) => v === params.get('need')) ?? null;
  const w = Number(params.get('watts'));
  const watts = (LAPTOP_WATTS as readonly number[]).includes(w) ? w : null;
  if (!device || !port || !need) return null;
  return { device, port: device === 'laptop' ? 'usb-c' : port, need, watts: device === 'laptop' ? watts ?? 45 : null };
}
