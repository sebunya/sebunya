import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

/**
 * The payment operations sweep (payments brief, 2026-08-06).
 *
 * Three mechanisms, every one OFF until an operator sets its number, because
 * each threshold is a business decision — how long stock may be held hostage
 * by an unpaid order, when an order counts as walked-away — and no developer
 * default belongs in either.
 *
 * Everything here acts through the REAL paths: reservations release through
 * the same transactional release checkout failures use, and orders cancel
 * through the canonical transition service, which writes the append-only
 * order_event. No status field is overwritten anywhere.
 */

export interface IPaymentsOpsConfigReader {
  /** Raw values; caller parses. Absent key = mechanism off. */
  values(): Promise<Record<string, string>>;
}

export interface IStaleOrderReader {
  /**
   * Unpaid, still in a pre-fulfilment state, older than the cutoff, and with
   * NO live payment attempt — every attempt terminal or none ever made. An
   * order with an attempt still `pending` is NEVER stale: the reconciliation
   * poller owns it, and the provider may still say COMPLETED.
   */
  listStaleUnpaidOrders(olderThan: Date, limit: number): Promise<
    Array<{ id: string; orderNumber: string; status: string; createdAt: Date }>
  >;
  /** Orders with an ACTIVE reservation, unpaid, in a pre-fulfilment state. */
  listReservedUnpaidOrders(olderThan: Date, limit: number): Promise<
    Array<{ id: string; orderNumber: string; createdAt: Date }>
  >;
}

const hoursFrom = (values: Record<string, string>, key: string): number | null => {
  const n = Number(values[key]);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Reservation TTL: stock held by an unpaid order goes back on sale.
 *
 * Thirteen units sat reserved for months because nothing ever expired. With
 * the TTL unset this does NOTHING — and says so, rather than being a silent
 * no-op indistinguishable from a broken one.
 */
export class ExpireStaleReservationsUseCase {
  constructor(
    private readonly config: IPaymentsOpsConfigReader,
    private readonly orders: IStaleOrderReader,
    private readonly inventory: { releaseForOrder(orderId: string): Promise<{ released: boolean }> },
    private readonly audit: IAuditRepository,
  ) {}

  async execute(now: Date = new Date()): Promise<{ released: number; skipped: 'ttl_not_configured' | null }> {
    const ttl = hoursFrom(await this.config.values(), 'reservation_ttl_hours');
    if (ttl === null) return { released: 0, skipped: 'ttl_not_configured' };

    const cutoff = new Date(now.getTime() - ttl * 3_600_000);
    const stale = await this.orders.listReservedUnpaidOrders(cutoff, 100);
    let released = 0;
    for (const order of stale) {
      const result = await this.inventory.releaseForOrder(order.id);
      if (!result.released) continue;
      released++;
      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: null,
        action: 'RESERVATION_EXPIRED',
        entity: 'order',
        entityId: order.id,
        previousState: { reservation: 'reserved' },
        newState: {
          reservation: 'released',
          reason: `Unpaid for more than ${ttl} hours (reservation_ttl_hours). Stock returned to sale.`,
          orderNumber: order.orderNumber,
        },
      });
    }
    return { released, skipped: null };
  }
}

/**
 * Order abandonment: an unpaid order past the window, with every payment
 * attempt terminal or none ever made, is cancelled through the canonical
 * lifecycle and its stock released.
 *
 * The exclusion matters more than the rule: an order whose attempt is still
 * `pending` is NEVER abandoned by time, because the provider may yet answer
 * COMPLETED — that is the reconciliation poller's case, and cancelling it
 * would be exactly the "money taken, no order" failure the timeout rule forbids.
 */
export class AbandonStaleUnpaidOrdersUseCase {
  constructor(
    private readonly config: IPaymentsOpsConfigReader,
    private readonly orders: IStaleOrderReader,
    private readonly transition: {
      transition(orderId: string, to: 'cancelled', ctx: {
        actorId?: string | null;
        actorType: 'system';
        source: 'system';
        reasonCode: string;
        note: string;
        idempotencyKey: string;
      }): Promise<unknown>;
    },
    private readonly inventory: { releaseForOrder(orderId: string): Promise<{ released: boolean }> },
    private readonly audit: IAuditRepository,
  ) {}

  async execute(now: Date = new Date()): Promise<{ abandoned: number; skipped: 'window_not_configured' | null; errors: string[] }> {
    const window = hoursFrom(await this.config.values(), 'order_abandonment_hours');
    if (window === null) return { abandoned: 0, skipped: 'window_not_configured', errors: [] };

    const cutoff = new Date(now.getTime() - window * 3_600_000);
    const stale = await this.orders.listStaleUnpaidOrders(cutoff, 100);
    let abandoned = 0;
    const errors: string[] = [];
    for (const order of stale) {
      try {
        await this.transition.transition(order.id, 'cancelled', {
          actorId: null,
          actorType: 'system',
          source: 'system',
          reasonCode: 'payment_abandoned',
          note: `Unpaid for more than ${window} hours with no live payment attempt (order_abandonment_hours).`,
          idempotencyKey: `abandon:${order.id}`,
        });
        await this.inventory.releaseForOrder(order.id).catch(() => ({ released: false }));
        abandoned++;
        await new CreateAuditLogUseCase(this.audit).execute({
          actorId: null,
          action: 'ORDER_ABANDONED_UNPAID',
          entity: 'order',
          entityId: order.id,
          previousState: { status: order.status, paymentStatus: 'unpaid' },
          newState: { status: 'cancelled', orderNumber: order.orderNumber, windowHours: window },
        });
      } catch (e) {
        errors.push(`${order.orderNumber}: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
      }
    }
    return { abandoned, skipped: null, errors };
  }
}

/**
 * RESERVED_LEDGER_MISMATCH becomes an ALERT, not a report line.
 *
 * The standing production finding — five orders at reservation_state RESERVED
 * while the reservation ledger disagreed — sat in a report nobody was reading.
 * The scan already existed; what was missing was anything that SHOUTED.
 */
export class AlertOnLedgerMismatchUseCase {
  constructor(
    private readonly scan: { execute(limit: number): Promise<{ exceptions: Array<{ type: string; entityId: string }> }> },
    private readonly alert: (input: { count: number; entityIds: string[] }) => void,
  ) {}

  async execute(): Promise<{ mismatches: number }> {
    const report = await this.scan.execute(1000);
    const mismatches = report.exceptions.filter((e) => e.type === 'RESERVED_LEDGER_MISMATCH');
    if (mismatches.length > 0) {
      this.alert({ count: mismatches.length, entityIds: mismatches.map((m) => m.entityId).slice(0, 20) });
    }
    return { mismatches: mismatches.length };
  }
}
