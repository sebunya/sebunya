/**
 * Customer 360 (0157, docs/first-party/README.md): the records ONE customer
 * profile is assembled from, and the pure shaping of them into a timeline.
 * The infrastructure reader fills Customer360Records from the authoritative
 * tables through the customer's identity links; nothing here reads a
 * database, and nothing here invents a record.
 */
import type { DeviceEvidence, TraitOrder } from './CustomerTraits';

export interface Customer360Order extends TraitOrder {
  orderNumber: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface Customer360Records {
  profile: {
    canonicalCustomerId: string;
    accountUserId: string | null;
    identityConfidence: string;
    lifecycleStage: string;
    createdAt: Date;
    mergedInto: string | null;
  };
  account: { id: string; email: string | null; phone: string | null; phoneVerified: boolean; createdAt: Date; isActive: boolean } | null;
  links: Array<{ signalType: string; status: string; confidence: string; identifierKey: string; createdAt: Date }>;
  /** Guest profiles folded into this one. */
  foldedProfiles: number;
  openConflicts: number;
  orders: Customer360Order[];
  carts: Array<{ cartId: string; updatedAt: Date; itemCount: number; converted: boolean }>;
  quotes: Array<{ reference: string | null; createdAt: Date; status: string; lineCount: number | null; totalUnits: number | null; estimatedTotalUgx: number | null; lines: Array<{ productName: string; quantity: number }> }>;
  loyalty: { balance: number; entries: number } | null;
  support: Array<{ subject: string; status: string; type: string; createdAt: Date }>;
  messages: Array<{ channel: string; template: string; status: string; at: Date; relatedEntity: string | null }>;
  /** Landing visits recorded for this customer's browsers (customer traffic only). */
  visits: Array<{ at: Date; channel: string; source: string | null; landingPath: string | null }>;
  categoryViews: Array<{ categoryId: string | null; categoryName: string | null }>;
  lastSeenAt: Date | null;
  consents: {
    tracking: Array<{ scope: 'account' | 'browser'; analytics: boolean; advertising: boolean; personalisation: boolean; grantType: string; updatedAt: Date }>;
    purposes: Array<{ purposeKey: string; channelKey: string; state: string; effectiveAt: Date }>;
  };
  attribution: Array<{ orderNumber: string; model: string; channel: string; detail: string; basis: string }>;
  selfReported: Array<{ orderNumber: string; answer: string | null; whatsappRef: string | null }>;
  devices: DeviceEvidence[];
  addressDistricts: string[];
  segments: Array<{ id: string; key: string; name: string; firstMatchedAt: Date }>;
  privacyRequests: Array<{ reference: string; kind: string; status: string; requestedAt: Date }>;
  finderSessions: Array<{ at: Date; status: string; answers: Record<string, string> }>;
}

export type TimelineKind = 'VISIT' | 'CART' | 'ORDER' | 'QUOTE' | 'MESSAGE' | 'SUPPORT' | 'CONSENT' | 'FINDER' | 'PRIVACY' | 'ACCOUNT';

export interface TimelineEvent {
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
}

const MAX_EVENTS = 200;
const ugx = (n: number) => `UGX ${n.toLocaleString('en-UG')}`;
const words = (v: string) => v.replace(/_/g, ' ').toLowerCase();

/** Newest first, capped. Every event is a recorded row; none is inferred. */
export function buildCustomerTimeline(r: Customer360Records): TimelineEvent[] {
  const out: Array<{ at: Date; kind: TimelineKind; title: string; detail: string | null }> = [];
  if (r.account) out.push({ at: r.account.createdAt, kind: 'ACCOUNT', title: 'Account created', detail: r.account.phoneVerified ? 'Phone verified' : null });
  for (const v of r.visits) out.push({ at: v.at, kind: 'VISIT', title: `Visit from ${words(v.channel)}`, detail: [v.source, v.landingPath].filter(Boolean).join(' · ') || null });
  for (const c of r.carts) out.push({ at: c.updatedAt, kind: 'CART', title: c.converted ? 'Basket became an order' : 'Basket left', detail: `${c.itemCount} item${c.itemCount === 1 ? '' : 's'}` });
  for (const o of r.orders) {
    out.push({
      at: o.placedAt, kind: 'ORDER', title: `Order ${o.orderNumber} · ${ugx(o.totalUgx)}`,
      detail: [words(o.status), `payment ${words(o.paymentStatus)}`, o.paymentMethod === 'offline' ? 'cash on delivery' : o.paymentMethod === 'pesapal' ? 'online' : null, o.district].filter(Boolean).join(' · '),
    });
  }
  for (const q of r.quotes) {
    out.push({ at: q.createdAt, kind: 'QUOTE', title: `Bulk quote ${q.reference ?? 'request'}`, detail: [q.lineCount !== null ? `${q.lineCount} products` : null, q.totalUnits !== null ? `${q.totalUnits} units` : null, words(q.status)].filter(Boolean).join(' · ') || null });
  }
  for (const m of r.messages) out.push({ at: m.at, kind: 'MESSAGE', title: `${m.channel.toUpperCase()} ${words(m.template)}`, detail: words(m.status) });
  for (const s of r.support) out.push({ at: s.createdAt, kind: 'SUPPORT', title: `Support: ${s.subject}`, detail: `${words(s.type)} · ${words(s.status)}` });
  for (const p of r.consents.purposes) out.push({ at: p.effectiveAt, kind: 'CONSENT', title: `${words(p.purposeKey)} (${p.channelKey})`, detail: words(p.state) });
  for (const f of r.finderSessions) out.push({ at: f.at, kind: 'FINDER', title: 'Used the product finder', detail: words(f.status) });
  for (const d of r.devices) if (d.source === 'BATTERY_REQUEST') out.push({ at: d.at, kind: 'FINDER', title: `Asked for a battery for ${d.label}`, detail: null });
  for (const p of r.privacyRequests) out.push({ at: p.requestedAt, kind: 'PRIVACY', title: `Privacy request ${p.reference}`, detail: `${words(p.kind)} · ${words(p.status)}` });
  return out
    .filter((e) => e.at instanceof Date && !Number.isNaN(e.at.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, MAX_EVENTS)
    .map((e) => ({ ...e, at: e.at.toISOString() }));
}

/** First and last four characters; a short key is fully hidden. Identifier keys are HMACs or ids, never shown whole. */
export function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••';
}

/** What kind of visitor id a link is, for the identity panel. */
export function describeLink(signalType: string, key: string): string {
  if (key.startsWith('order:')) return 'Order';
  if (key.startsWith('xp:')) return 'Visitor profile';
  if (key.startsWith('fp:')) return 'Browser id';
  switch (signalType) {
    case 'AUTHENTICATED_CUSTOMER_ID': return 'Account';
    case 'VERIFIED_PHONE': return 'Verified phone';
    case 'VERIFIED_EMAIL': return 'Verified email';
    case 'CONTACT_PHONE': return 'Phone (typed)';
    case 'CONTACT_EMAIL': return 'Email (typed)';
    default: return words(signalType);
  }
}
