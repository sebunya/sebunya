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
  onFailed?(hold: 'inventory' | 'redemption', orderId: string, error: unknown): void;
}

export class ReleaseCancelledOrderHoldsUseCase {
  constructor(private readonly deps: ReleaseCancelledOrderHoldsDeps) {}

  async execute(orderId: string): Promise<void> {
    await this.isolated('redemption', orderId, () => this.deps.releaseRedemption.execute({ orderId }));
    await this.isolated('inventory', orderId, () => this.deps.releaseInventory.execute(orderId));
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
