export interface CommerceSnapshot {
  /** Orders created inside the window. */
  orderCount: number;
  /** Orders currently marked paid inside the window. */
  paidOrderCount: number;
  /** Sum of totalAmount (UGX) of paid orders inside the window. */
  paidRevenue: number;
  /** Top products by quantity ordered inside the window. */
  topProducts: Array<{ productName: string; sku: string; quantity: number }>;
}

export interface SystemHealthSnapshot {
  /** Outbox events waiting to be processed (backlog). */
  pendingOutboxEvents: number;
  /** Notification attempts that FAILED inside the window. */
  failedNotifications: number;
}

export interface IDashboardReadRepository {
  getCommerceSnapshot(since: Date): Promise<CommerceSnapshot>;
  getSystemHealthSnapshot(since: Date): Promise<SystemHealthSnapshot>;
}
