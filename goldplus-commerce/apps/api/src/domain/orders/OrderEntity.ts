export class OrderEntity {
  constructor(
    public readonly id: string,
    public status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED'
  ) {}

  public markAsPaid() {
    if(this.status !== 'PENDING_PAYMENT') throw new Error("Cannot pay an order not in pending state");
    this.status = 'PAID';
  }
}
