/** When an order reached the customer: its latest real move to delivered or completed, or null. */
export interface IOrderDeliveredAt {
  deliveredAt(orderNumber: string): Promise<Date | null>;
}
