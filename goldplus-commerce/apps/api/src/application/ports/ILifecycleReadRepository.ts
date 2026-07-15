import { ConsentState } from '../../domain/identity/CustomerLifecycle';

export interface CustomerOrderStats {
  userId: string;
  ordersCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

/** Slice 9: read-only signals from EXISTING stores — no second profile store. */
export interface ILifecycleReadRepository {
  /** Per-registered-customer order aggregates (orders with a user id only). */
  listCustomerOrderStats(limit?: number): Promise<CustomerOrderStats[]>;
  /**
   * Personalisation consent from the canonical consent states. Anything that
   * is not an unexpired granted row resolves to 'denied'/'unknown' truthfully.
   */
  getPersonalisationConsent(userIds: string[]): Promise<Map<string, ConsentState>>;
}
