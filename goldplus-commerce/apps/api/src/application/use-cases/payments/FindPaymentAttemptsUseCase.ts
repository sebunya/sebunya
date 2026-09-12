/**
 * Find payment attempts by the identifiers staff actually receive (admin
 * maturity pass, 2026-09-12, §26): a merchant reference from a receipt, a
 * provider tracking id from a PesaPal email, or the order number / id from the
 * customer. The payments page previously listed only the 50 most recent
 * attempts with no search at all. Exact matches only — these are keys, not
 * free text — so no scan; every branch is an indexed lookup.
 */
export interface FindPaymentAttemptsDeps<A extends { id: string }> {
  findByMerchantReference(ref: string): Promise<A | null>;
  findByTrackingId(trackingId: string): Promise<A | null>;
  /** Accepts an order number or an order uuid, as the order repository does. */
  findOrder(idOrNumber: string): Promise<{ id: string } | null>;
  findAttemptsByOrderId(orderId: string): Promise<A[]>;
}

export class FindPaymentAttemptsUseCase<A extends { id: string }> {
  constructor(private readonly deps: FindPaymentAttemptsDeps<A>) {}

  /** Empty or blank query -> empty result; the caller keeps its default listing. */
  async execute(query: string): Promise<A[]> {
    const q = query.trim();
    if (!q || q.length > 120) return [];
    const seen = new Map<string, A>();
    const add = (a: A | null | undefined) => { if (a && !seen.has(a.id)) seen.set(a.id, a); };
    add(await this.deps.findByMerchantReference(q));
    add(await this.deps.findByTrackingId(q));
    const order = await this.deps.findOrder(q);
    if (order) for (const a of await this.deps.findAttemptsByOrderId(order.id)) add(a);
    return [...seen.values()];
  }
}
