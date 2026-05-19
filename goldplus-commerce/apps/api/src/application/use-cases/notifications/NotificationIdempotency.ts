export interface IdempotencyInput {
  orderId: string;
  eventType: string;
  channel: string;
  templateName: string;
  paymentStatus: string;
  orderStatus: string;
  statusVersion: string | number;
}

export class NotificationIdempotency {
  public static buildKey(input: IdempotencyInput): string {
    const orderId = (input.orderId || '').trim();
    const eventType = (input.eventType || '').trim();
    const channel = (input.channel || '').trim().toLowerCase();
    const templateName = (input.templateName || '').trim();
    const paymentStatus = (input.paymentStatus || '').trim().toLowerCase();
    const orderStatus = (input.orderStatus || '').trim().toLowerCase();
    const statusVersion = String(input.statusVersion ?? '1').trim().toLowerCase();

    // Enforce strict delimiters and casing
    const parts = [
      orderId,
      eventType,
      channel,
      templateName,
      paymentStatus,
      orderStatus,
      statusVersion,
    ];

    // Join with standard stable colon delimiter
    return parts.join(':');
  }
}
