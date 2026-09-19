import { createHash } from 'crypto';
import { z } from 'zod';

/**
 * Authoritative commerce events (dossier §3, GP-CON/GP-EVT).
 *
 * Produced by the server inside the transaction that caused them, never from a
 * browser claim. Money is a signed base-10 integer string (UGX) so it survives
 * JSON without floating-point loss. Payloads are strict: unknown keys reject.
 */

export const COMMERCE_EVENT_NAMES = ['order_created', 'order_confirmed', 'order_dispatched', 'order_delivered', 'order_cancelled'] as const;
export type CommerceEventName = typeof COMMERCE_EVENT_NAMES[number];
export type Environment = 'development' | 'test' | 'staging' | 'production';

const MoneyUGX = z.string().regex(/^-?\d{1,18}$/, 'money must be a signed integer string');
const Id = z.string().min(1).max(128);

const Line = z.object({
  lineId: Id, productId: Id, sku: z.string().min(1).max(64), name: z.string().max(255),
  quantity: z.number().int().positive(), netLineUGX: MoneyUGX,
  /** Cost frozen at sale (order_items.cogs_snapshot_ugx); null = unknown, never zero. */
  cogsUGX: MoneyUGX.nullable(),
}).strict();

const OrderTotals = z.object({
  orderId: Id,
  orderNumber: z.string().min(1).max(40),
  currency: z.literal('UGX'),
  /** Merchandise after every discount (line discounts and loyalty), before tax/delivery. */
  netMerchandiseUGX: MoneyUGX,
  collectedDeliveryUGX: MoneyUGX,
  taxUGX: MoneyUGX,
  paymentMethod: z.enum(['pesapal', 'offline', 'unknown']),
  items: z.array(Line).min(1).max(200),
}).strict();

export const OrderCreatedData = OrderTotals;
export const OrderConfirmedData = OrderTotals.extend({
  confirmationBasis: z.enum(['payment_verified', 'approved_cod']),
  economicPolicyVersion: z.string().min(1).max(20),
}).strict();
export const OrderStatusData = z.object({
  orderId: Id, orderNumber: z.string().min(1).max(40), fromStatus: z.string().max(40), toStatus: z.string().max(40),
  reasonCode: z.string().max(120).nullable(),
}).strict();

export const EVENT_DATA_SCHEMAS: Record<CommerceEventName, z.ZodTypeAny> = {
  order_created: OrderCreatedData,
  order_confirmed: OrderConfirmedData,
  order_dispatched: OrderStatusData,
  order_delivered: OrderStatusData,
  order_cancelled: OrderStatusData,
};

export const ECONOMIC_POLICY_VERSION = 'ugx-v1';
export const CANONICAL_HASH_VERSION = 'v1';

/**
 * Canonical serialisation: keys sorted at every level, no whitespace. Volatile
 * fields (receive/attempt times, trace ids) are NOT part of the payload, so a
 * replay of the same transition produces the same hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
export const canonicalSha256 = (eventName: string, payload: unknown) =>
  createHash('sha256').update(`${CANONICAL_HASH_VERSION}:${eventName}:${canonicalJson(payload)}`).digest('hex');

/**
 * One business effect per source transition. Order-level milestones happen once
 * per order (a second "confirmed" is not a second sale), so they key on the order.
 */
export function businessDedupeKey(eventName: CommerceEventName, orderId: string): string {
  return `${eventName}:order:${orderId}`;
}

export function environmentOf(nodeEnv: string | undefined): Environment {
  return nodeEnv === 'production' ? 'production' : nodeEnv === 'test' ? 'test' : nodeEnv === 'staging' ? 'staging' : 'development';
}

/** Validates a payload for its event (throws a ZodError naming the field). */
export function validateEventData(eventName: CommerceEventName, data: unknown): unknown {
  return EVENT_DATA_SCHEMAS[eventName].parse(data);
}

/** The transition → event mapping (dossier §3.3), pure so it is testable. */
export function eventForTransition(input: { toStatus: string; paymentStatus: string | null | undefined }): CommerceEventName | null {
  if (input.toStatus === 'processing' && input.paymentStatus === 'paid') return 'order_confirmed';
  if (input.toStatus === 'dispatched') return 'order_dispatched';
  if (input.toStatus === 'delivered') return 'order_delivered';
  if (input.toStatus === 'cancelled') return 'order_cancelled';
  return null;
}
