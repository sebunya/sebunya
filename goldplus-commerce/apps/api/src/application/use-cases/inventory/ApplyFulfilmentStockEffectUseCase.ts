/**
 * What a fulfilment move does to stock (Section 12), in ONE application use
 * case instead of an HTTP route.
 *
 *   READY_FOR_DISPATCH  → the reservation is used up: on-hand stock goes down.
 *   task CANCELLED      → held stock goes back on sale — unless the ORDER is
 *                         already dispatched, delivered or completed. Those
 *                         goods have left the shop; releasing them put units
 *                         already gone back on sale. They are consumed instead.
 *   order closed        → an order closed without dispatch (processing →
 *   (delivered /          completed at the counter) never reached
 *    completed)           READY_FOR_DISPATCH, so its units stayed reserved
 *                         for good. Consumed when it closes; a no-op when the
 *                         dispatch already consumed it.
 *
 * Every effect is idempotent (only 'reserved' rows move) and never fails the
 * move that already committed. It used to run inside the route in a
 * try/catch that only printed to the console: a deadlock there left a
 * dispatched order holding its reservation for good, and nothing could see
 * it. A failure is now REPORTED (error log + audit row), and the integrity
 * scan flags any closed order still holding a reservation
 * (DISPATCHED_WITH_RESERVATION).
 */
export interface FulfilmentStockEffectDeps {
  inventory: {
    consumeForOrder(orderId: string): Promise<{ consumed: boolean }>;
    releaseForOrder(orderId: string): Promise<{ released: boolean }>;
  };
  orders: { findStatus(orderId: string): Promise<string | null> };
  /** The admin "order cancelled" email; only for an order that is really cancelled. */
  notifyCancelled?(orderId: string): Promise<void>;
  report(input: { orderId: string; effect: 'consume' | 'release' | 'notify'; error: unknown }): Promise<void> | void;
}

/** Order statuses whose goods have left the shop. */
export const GOODS_LEFT_STATUSES: ReadonlySet<string> = new Set(['dispatched', 'delivered', 'completed']);

export class ApplyFulfilmentStockEffectUseCase {
  constructor(private readonly deps: FulfilmentStockEffectDeps) {}

  async afterTaskTransition(orderId: string, toTaskStatus: string): Promise<void> {
    if (toTaskStatus === 'READY_FOR_DISPATCH') {
      await this.isolated(orderId, 'consume', () => this.deps.inventory.consumeForOrder(orderId));
      return;
    }
    if (toTaskStatus !== 'CANCELLED') return;
    // A failed read is NOT "not closed": treating it so released the stock of
    // an order whose goods had left and sent a false cancellation email. The
    // failure is reported and nothing moves; the integrity scan still sees a
    // reservation left behind.
    let orderStatus: string | null;
    try {
      orderStatus = await this.deps.orders.findStatus(orderId);
    } catch (error) {
      await this.reportSafely(orderId, 'release', error);
      return;
    }
    if (orderStatus && GOODS_LEFT_STATUSES.has(orderStatus)) {
      // Tidying a stranded task on an order that is already closed: the goods
      // are gone, so the reservation is used up, never released. No "order
      // cancelled" email — the order was not cancelled.
      await this.isolated(orderId, 'consume', () => this.deps.inventory.consumeForOrder(orderId));
      return;
    }
    await this.isolated(orderId, 'release', () => this.deps.inventory.releaseForOrder(orderId));
    if (this.deps.notifyCancelled) {
      await this.isolated(orderId, 'notify', () => this.deps.notifyCancelled!(orderId));
    }
  }

  async consumeForClosedOrder(orderId: string): Promise<void> {
    await this.isolated(orderId, 'consume', () => this.deps.inventory.consumeForOrder(orderId));
  }

  private async isolated(orderId: string, effect: 'consume' | 'release' | 'notify', run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      await this.reportSafely(orderId, effect, error);
    }
  }

  private async reportSafely(orderId: string, effect: 'consume' | 'release' | 'notify', error: unknown): Promise<void> {
    try {
      await this.deps.report({ orderId, effect, error });
    } catch {
      // A failing reporter must not break the move that already committed.
    }
  }
}
