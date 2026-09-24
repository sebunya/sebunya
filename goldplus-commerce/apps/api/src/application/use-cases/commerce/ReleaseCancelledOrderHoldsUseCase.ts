/**
 * What a cancelled order must give back: the stock it was holding and any
 * loyalty points it had reserved.
 *
 * WHY THIS EXISTS
 * Only the fulfilment-task CANCELLED route and the payment sweeps released
 * stock. An order cancelled through the LIFECYCLE — the admin order page's
 * "cancelled" transition, or a provider reversal — released its points and kept
 * its units in products.reserved_quantity for good. The TTL sweep could not
 * catch it later either, because it only looks at received/pending_payment
 * orders. Available stock was quietly under-stated, and a fast-moving product
 * could read out of stock (or block checkout) while it sat on the shelf.
 *
 * Both releases are idempotent, and each is isolated: a loyalty failure must
 * not keep the stock held, and neither may fail the transition that already
 * committed. A failure is REPORTED, never swallowed silently — a hold nobody
 * knows is stuck is exactly the defect this closes.
 */
export interface ReleaseCancelledOrderHoldsDeps {
  releaseInventory: { execute(orderId: string): Promise<unknown> };
  releaseRedemption: { execute(input: { orderId: string }): Promise<unknown> };
  /**
   * Points already SPENT on the order (an applied redemption) cannot be
   * released; they are reversed instead, returning with their original expiry.
   * Without this an admin cancel of a paid order kept the customer's points.
   */
  reverseRedemption?: { execute(input: { orderId: string; reason: string }): Promise<unknown> };
  onFailed?(hold: 'inventory' | 'redemption', orderId: string, error: unknown): void;
  /**
   * Optional together. Stock is taken off at READY_FOR_DISPATCH, and an order
   * can still be cancelled after that (a refused delivery, a packed order the
   * customer called off). Releasing finds nothing to release, so the units
   * stayed off the count for good and nobody was told. Nothing restocks
   * automatically — a returned unit may be damaged or missing, and only a
   * person at the shelf knows — so this TELLS someone to record the return.
   */
  reservations?: { summariseReservations(orderId: string): Promise<{ consumed: number }> };
  onStockAlreadyTaken?(orderId: string, consumedLines: number): Promise<void> | void;
}

export class ReleaseCancelledOrderHoldsUseCase {
  constructor(private readonly deps: ReleaseCancelledOrderHoldsDeps) {}

  async execute(orderId: string): Promise<void> {
    await this.isolated('redemption', orderId, async () => {
      const released = (await this.deps.releaseRedemption.execute({ orderId })) as { ok?: boolean; code?: string } | undefined;
      if (released?.ok === false && released.code === 'NOT_RESERVED' && this.deps.reverseRedemption) {
        await this.deps.reverseRedemption.execute({ orderId, reason: 'Order cancelled' });
      }
    });
    await this.isolated('inventory', orderId, async () => {
      const released = (await this.deps.releaseInventory.execute(orderId)) as { released?: boolean } | undefined;
      if (released?.released === false && this.deps.reservations && this.deps.onStockAlreadyTaken) {
        const summary = await this.deps.reservations.summariseReservations(orderId);
        if (summary.consumed > 0) await this.deps.onStockAlreadyTaken(orderId, summary.consumed);
      }
    });
  }

  private async isolated(hold: 'inventory' | 'redemption', orderId: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      try {
        this.deps.onFailed?.(hold, orderId, error);
      } catch {
        // Deliberately swallowed: a failing reporter must not break the release.
      }
    }
  }
}
