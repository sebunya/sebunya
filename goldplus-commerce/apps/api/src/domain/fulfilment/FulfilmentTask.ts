/**
 * Launch Phase 1 (Section 9.3) — Order-to-Admin Fulfilment Alert.
 *
 * Every successfully placed order creates exactly one actionable admin
 * fulfilment task. The task is the internal "New Orders" work item: it carries
 * a truthful payment status, the full product summary, and moves through an
 * explicit operations lifecycle. This is a pure domain model — no Hono, no
 * Drizzle, no adapters.
 */

export type FulfilmentStatus =
  | 'NEW'
  | 'ACKNOWLEDGED'
  | 'PICKING'
  | 'PACKED'
  | 'READY_FOR_DISPATCH'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'ON_HOLD';

/** Payment status mirrored from the order — never invented here. */
export type FulfilmentPaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed';

/** Operations priority — drives the deterministic SLA deadline and queue ordering. */
export type FulfilmentPriority = 'low' | 'normal' | 'high' | 'urgent';

export const FULFILMENT_PRIORITIES: readonly FulfilmentPriority[] = ['low', 'normal', 'high', 'urgent'];

/** Deterministic SLA windows (hours) from task creation, by priority. No hidden state. */
export const FULFILMENT_SLA_HOURS: Record<FulfilmentPriority, number> = {
  urgent: 4,
  high: 12,
  normal: 24,
  low: 48,
};

/** Pure SLA deadline: creation time + the priority window. */
export function computeSlaDueAt(createdAt: Date, priority: FulfilmentPriority): Date {
  return new Date(createdAt.getTime() + FULFILMENT_SLA_HOURS[priority] * 60 * 60 * 1000);
}

export const FULFILMENT_STATUSES: readonly FulfilmentStatus[] = [
  'NEW',
  'ACKNOWLEDGED',
  'PICKING',
  'PACKED',
  'READY_FOR_DISPATCH',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'ON_HOLD',
];

/** Terminal states never transition further. */
export const TERMINAL_FULFILMENT_STATUSES: readonly FulfilmentStatus[] = ['DELIVERED', 'CANCELLED'];

/**
 * Allowed forward transitions. A task may always be put ON_HOLD or CANCELLED
 * from any non-terminal state; ON_HOLD returns to the state it is resumed into.
 * Backward moves are deliberately excluded so the audit trail stays honest.
 */
const FORWARD: Record<FulfilmentStatus, FulfilmentStatus[]> = {
  NEW: ['ACKNOWLEDGED', 'PICKING'],
  ACKNOWLEDGED: ['PICKING'],
  PICKING: ['PACKED'],
  PACKED: ['READY_FOR_DISPATCH'],
  READY_FOR_DISPATCH: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  ON_HOLD: ['ACKNOWLEDGED', 'PICKING', 'PACKED', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY'],
};

export function isTerminalFulfilmentStatus(status: FulfilmentStatus): boolean {
  return TERMINAL_FULFILMENT_STATUSES.includes(status);
}

/** Pure transition predicate — the single source of truth for the lifecycle. */
export function canTransitionFulfilment(from: FulfilmentStatus, to: FulfilmentStatus): boolean {
  if (from === to) return false;
  if (isTerminalFulfilmentStatus(from)) return false;
  if (to === 'CANCELLED') return true; // any active task may be cancelled
  if (to === 'ON_HOLD') return from !== 'ON_HOLD';
  return FORWARD[from]?.includes(to) ?? false;
}

export function allowedFulfilmentTransitions(from: FulfilmentStatus): FulfilmentStatus[] {
  return FULFILMENT_STATUSES.filter((s) => canTransitionFulfilment(from, s));
}

export interface FulfilmentItemLine {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceUgx: number;
  lineTotalUgx: number;
}

export interface FulfilmentTaskSnapshot {
  id: string;
  orderId: string;
  orderNumber: string;
  status: FulfilmentStatus;
  paymentStatus: FulfilmentPaymentStatus;
  paymentMethod: string | null;
  customerName: string;
  customerContactMasked: string;
  deliveryArea: string;
  deliverySummary: string;
  totalUgx: number;
  deliveryFeeUgx: number;
  itemCount: number;
  items: FulfilmentItemLine[];
  warnings: string[];
  priority: FulfilmentPriority;
  slaDueAt: Date;
  /** Owning team (queue). One active team owner per task. */
  teamId: string | null;
  assignedTo: string | null;
  assignedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Contact masking so the fulfilment queue never leaks a raw phone/email. */
export function maskContact(phone: string | null | undefined, email: string | null | undefined): string {
  const p = (phone ?? '').trim();
  if (p.length >= 6) return p.slice(0, 3) + '****' + p.slice(-2);
  const e = (email ?? '').trim();
  if (e.includes('@')) {
    const [name, domain] = e.split('@');
    const head = name.length <= 1 ? name : name.slice(0, 1);
    return `${head}***@${domain}`;
  }
  return '*****';
}

export class FulfilmentTask {
  private constructor(private snap: FulfilmentTaskSnapshot) {}

  static rehydrate(snapshot: FulfilmentTaskSnapshot): FulfilmentTask {
    return new FulfilmentTask({ ...snapshot, items: [...snapshot.items], warnings: [...snapshot.warnings] });
  }

  /**
   * Build the initial NEW task for a freshly placed order. Payment status is
   * mirrored truthfully; a paid order is immediately ready for preparation,
   * an unpaid one still enters the queue so staff can see it.
   */
  static openForOrder(input: {
    id: string;
    orderId: string;
    orderNumber: string;
    paymentStatus: FulfilmentPaymentStatus;
    paymentMethod?: string | null;
    customerName: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    deliveryArea: string;
    deliverySummary: string;
    totalUgx: number;
    deliveryFeeUgx: number;
    items: FulfilmentItemLine[];
    warnings?: string[];
    priority?: FulfilmentPriority;
    /**
     * When stock could not be fully reserved the task opens ON_HOLD (backordered)
     * rather than NEW, so it is never presented to staff as ready for preparation.
     */
    hold?: boolean;
    now?: Date;
  }): FulfilmentTask {
    if (!input.items || input.items.length === 0) {
      throw new Error('FULFILMENT_TASK_REQUIRES_ITEMS');
    }
    const now = input.now ?? new Date();
    const itemCount = input.items.reduce((sum, i) => sum + i.quantity, 0);
    const priority = input.priority ?? 'normal';
    return new FulfilmentTask({
      id: input.id,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      status: input.hold ? 'ON_HOLD' : 'NEW',
      paymentStatus: input.paymentStatus,
      paymentMethod: input.paymentMethod ?? null,
      customerName: input.customerName,
      customerContactMasked: maskContact(input.customerPhone, input.customerEmail),
      deliveryArea: input.deliveryArea,
      deliverySummary: input.deliverySummary,
      totalUgx: input.totalUgx,
      deliveryFeeUgx: input.deliveryFeeUgx,
      itemCount,
      items: [...input.items],
      warnings: [...(input.warnings ?? [])],
      priority,
      slaDueAt: computeSlaDueAt(now, priority),
      teamId: null,
      assignedTo: null,
      assignedAt: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  get id(): string { return this.snap.id; }
  get orderId(): string { return this.snap.orderId; }
  get status(): FulfilmentStatus { return this.snap.status; }
  get paymentStatus(): FulfilmentPaymentStatus { return this.snap.paymentStatus; }
  get priority(): FulfilmentPriority { return this.snap.priority; }
  get slaDueAt(): Date { return this.snap.slaDueAt; }
  get teamId(): string | null { return this.snap.teamId; }
  get assignedTo(): string | null { return this.snap.assignedTo; }

  /** Overdue = past the SLA deadline and not yet in a terminal state. */
  isOverdue(now: Date = new Date()): boolean {
    if (isTerminalFulfilmentStatus(this.snap.status)) return false;
    return now.getTime() > this.snap.slaDueAt.getTime();
  }

  /** A task is ready for preparation once payment is confirmed (or on active pipeline states). */
  get readyForPreparation(): boolean {
    return this.snap.paymentStatus === 'paid';
  }

  toSnapshot(): FulfilmentTaskSnapshot {
    return { ...this.snap, items: [...this.snap.items], warnings: [...this.snap.warnings] };
  }

  /** Idempotently mirror the order's payment status (PaymentConfirmed path). */
  applyPaymentStatus(paymentStatus: FulfilmentPaymentStatus, now: Date = new Date()): boolean {
    if (this.snap.paymentStatus === paymentStatus) return false;
    this.snap = { ...this.snap, paymentStatus, updatedAt: now };
    return true;
  }

  /** Move through the lifecycle. Throws INVALID_TRANSITION on an illegal move. */
  transition(to: FulfilmentStatus, opts: { assignedTo?: string | null; notes?: string | null; now?: Date } = {}): void {
    if (!canTransitionFulfilment(this.snap.status, to)) {
      throw new Error(`INVALID_TRANSITION: cannot move fulfilment task from ${this.snap.status} to ${to}`);
    }
    this.snap = {
      ...this.snap,
      status: to,
      assignedTo: opts.assignedTo !== undefined ? opts.assignedTo : this.snap.assignedTo,
      notes: opts.notes !== undefined ? opts.notes : this.snap.notes,
      updatedAt: opts.now ?? new Date(),
    };
  }

  /** Idempotent cancel used by the OrderCancelled path. Returns false if already terminal. */
  cancel(now: Date = new Date()): boolean {
    if (this.snap.status === 'CANCELLED') return false;
    if (isTerminalFulfilmentStatus(this.snap.status)) {
      throw new Error(`INVALID_TRANSITION: cannot cancel a ${this.snap.status} task`);
    }
    this.snap = { ...this.snap, status: 'CANCELLED', updatedAt: now };
    return true;
  }

  /** Assign (or unassign with null) the task to a staff member. Refuses on terminal tasks. */
  assign(userId: string | null, now: Date = new Date()): void {
    if (isTerminalFulfilmentStatus(this.snap.status)) {
      throw new Error(`INVALID_ASSIGNMENT: cannot assign a ${this.snap.status} task`);
    }
    this.snap = {
      ...this.snap,
      assignedTo: userId,
      assignedAt: userId ? now : null,
      updatedAt: now,
    };
  }

  /**
   * Move the task to a team queue (or clear with null). One active team owner per
   * task. Moving to a different team clears any individual assignee that is no
   * longer eligible — the caller re-validates eligibility. Refuses terminal tasks.
   */
  assignToTeam(teamId: string | null, opts: { clearAssignee?: boolean; now?: Date } = {}): void {
    if (isTerminalFulfilmentStatus(this.snap.status)) {
      throw new Error(`INVALID_ASSIGNMENT: cannot move a ${this.snap.status} task between teams`);
    }
    const now = opts.now ?? new Date();
    this.snap = {
      ...this.snap,
      teamId,
      assignedTo: opts.clearAssignee ? null : this.snap.assignedTo,
      assignedAt: opts.clearAssignee ? null : this.snap.assignedAt,
      updatedAt: now,
    };
  }

  /**
   * Change priority and recompute the SLA deadline relative to the ORIGINAL
   * creation time, so the deadline stays deterministic and cannot be gamed by
   * re-prioritising late. Refuses on terminal tasks.
   */
  setPriority(priority: FulfilmentPriority, now: Date = new Date()): void {
    if (isTerminalFulfilmentStatus(this.snap.status)) {
      throw new Error(`INVALID_PRIORITY: cannot re-prioritise a ${this.snap.status} task`);
    }
    this.snap = {
      ...this.snap,
      priority,
      slaDueAt: computeSlaDueAt(this.snap.createdAt, priority),
      updatedAt: now,
    };
  }
}
