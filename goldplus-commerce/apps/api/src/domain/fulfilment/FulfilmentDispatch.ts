/**
 * F4 — dispatch tracking (pure domain, no Drizzle/Hono).
 *
 * A dispatch is the truthful record of an order leaving the store with a rider,
 * courier, pickup or third party. It is recorded only once per fulfilment task
 * (idempotent), only from READY_FOR_DISPATCH — the single point at which on-hand
 * stock has already been consumed. Recording a dispatch never consumes stock; it
 * describes a hand-over that has happened. Payment policy is enforced here: an
 * order that is not paid may only be dispatched under an explicit cash-on-delivery
 * acknowledgement.
 */

import { FulfilmentPaymentStatus, FulfilmentStatus } from './FulfilmentTask';

export type FulfilmentDispatchMethod = 'RIDER' | 'COURIER' | 'PICKUP' | 'THIRD_PARTY';
export const FULFILMENT_DISPATCH_METHODS: readonly FulfilmentDispatchMethod[] = ['RIDER', 'COURIER', 'PICKUP', 'THIRD_PARTY'];

/** Dispatch-phase tracking only. Delivery outcomes (DELIVERED/FAILED/…) belong to F5. */
export type FulfilmentDispatchTrackingStatus = 'DISPATCHED' | 'IN_TRANSIT' | 'HANDED_OVER';
export const FULFILMENT_DISPATCH_TRACKING_STATUSES: readonly FulfilmentDispatchTrackingStatus[] = ['DISPATCHED', 'IN_TRANSIT', 'HANDED_OVER'];

/** Which policy permitted the dispatch — recorded truthfully for the audit trail. */
export type FulfilmentDispatchPaymentPolicy = 'PAID' | 'CASH_ON_DELIVERY';

export type FulfilmentDispatchError =
  | 'TASK_ON_HOLD'
  | 'TASK_NOT_DISPATCHABLE'
  | 'NOT_READY_FOR_DISPATCH'
  | 'PAYMENT_NOT_CLEARED';

export interface FulfilmentDispatchSnapshot {
  id: string;
  fulfilmentTaskId: string;
  orderId: string;
  dispatchReference: string;
  method: FulfilmentDispatchMethod;
  carrierName: string | null;
  riderName: string | null;
  contactMasked: string | null;
  paymentPolicy: FulfilmentDispatchPaymentPolicy;
  trackingStatus: FulfilmentDispatchTrackingStatus;
  stockConsumed: boolean;
  dispatchTime: Date;
  estimatedDeliveryAt: Date | null;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pure dispatch eligibility. A dispatch may be initiated only from
 * READY_FOR_DISPATCH — the state entered after packing where stock is already
 * consumed exactly once. ON_HOLD and unpacked/terminal states are rejected, and
 * an unpaid order requires an explicit cash-on-delivery acknowledgement.
 */
export function canDispatch(input: {
  status: FulfilmentStatus;
  paymentStatus: FulfilmentPaymentStatus;
  allowCashOnDelivery: boolean;
}): { ok: true; paymentPolicy: FulfilmentDispatchPaymentPolicy } | { ok: false; code: FulfilmentDispatchError } {
  if (input.status === 'ON_HOLD') return { ok: false, code: 'TASK_ON_HOLD' };
  if (input.status === 'DELIVERED' || input.status === 'CANCELLED') return { ok: false, code: 'TASK_NOT_DISPATCHABLE' };
  if (input.status !== 'READY_FOR_DISPATCH') return { ok: false, code: 'NOT_READY_FOR_DISPATCH' };
  if (input.paymentStatus === 'paid') return { ok: true, paymentPolicy: 'PAID' };
  if (input.allowCashOnDelivery) return { ok: true, paymentPolicy: 'CASH_ON_DELIVERY' };
  return { ok: false, code: 'PAYMENT_NOT_CLEARED' };
}

/** Mask a rider/customer contact so a dispatch record never leaks a raw phone. */
export function maskDispatchContact(contact: string | null | undefined): string | null {
  const c = (contact ?? '').trim();
  if (!c) return null;
  if (c.length >= 6) return c.slice(0, 3) + '****' + c.slice(-2);
  return '*****';
}

/** Deterministic human-readable dispatch reference derived from the order number. */
export function buildDispatchReference(orderNumber: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `DSP-${orderNumber}-${stamp}`;
}

/**
 * Dispatch entity — carries optimistic-concurrency mutation of the mutable
 * tracking fields (tracking status, ETA, notes). Immutable facts (reference,
 * method, payment policy, stock-consumed, dispatch time) are set once at creation.
 */
export class FulfilmentDispatch {
  private constructor(private snap: FulfilmentDispatchSnapshot) {}

  static rehydrate(snapshot: FulfilmentDispatchSnapshot): FulfilmentDispatch {
    return new FulfilmentDispatch({ ...snapshot });
  }

  get id(): string { return this.snap.id; }
  get version(): number { return this.snap.version; }
  get trackingStatus(): FulfilmentDispatchTrackingStatus { return this.snap.trackingStatus; }

  /** Update mutable tracking fields and bump the version for the optimistic write. */
  updateTracking(
    patch: { trackingStatus?: FulfilmentDispatchTrackingStatus; estimatedDeliveryAt?: Date | null; notes?: string | null },
    now: Date = new Date()
  ): void {
    this.snap = {
      ...this.snap,
      trackingStatus: patch.trackingStatus ?? this.snap.trackingStatus,
      estimatedDeliveryAt: patch.estimatedDeliveryAt !== undefined ? patch.estimatedDeliveryAt : this.snap.estimatedDeliveryAt,
      notes: patch.notes !== undefined ? patch.notes : this.snap.notes,
      version: this.snap.version + 1,
      updatedAt: now,
    };
  }

  toSnapshot(): FulfilmentDispatchSnapshot {
    return { ...this.snap };
  }
}
