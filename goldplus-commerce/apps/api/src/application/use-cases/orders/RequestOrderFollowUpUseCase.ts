import { OpenSupportTicketResult } from '../governance/OpenSupportTicketUseCase';

/**
 * "Ask our team to follow up on this order", from the Track Order page.
 *
 * The page used to raise the ticket itself through the public support form,
 * sending `phone: ''` whenever the customer had verified with their EMAIL — and
 * a support ticket requires a phone (it is the reply channel), so every
 * email-verified customer got "A valid Ugandan phone number is required." and
 * no ticket reached the team. The verified order already carries the phone
 * the customer checked out with; this uses it, so the proof the customer gave
 * (reference + phone OR email) is enough, as the page promises.
 *
 * The caller has ALREADY verified the order by contact. This only composes the
 * ticket from the order's own facts plus the customer's optional note.
 */
export interface FollowUpOrder {
  orderNumber: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  deliveryArea?: string | null;
  orderStatus?: string | null;
  paymentStatus?: string | null;
}

export class RequestOrderFollowUpUseCase {
  constructor(
    private readonly tickets: {
      execute(input: {
        subject: string;
        description: string;
        email: string;
        phone: string;
        productModel?: string;
        metadata?: Record<string, unknown>;
      }): Promise<OpenSupportTicketResult>;
    },
  ) {}

  async execute(input: { order: FollowUpOrder; verifiedContact: string; note?: unknown }): Promise<OpenSupportTicketResult> {
    const { order } = input;
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 800) : '';
    const contact = input.verifiedContact.trim();
    const email = contact.includes('@') ? contact : (order.customerEmail ?? '').trim();
    return this.tickets.execute({
      subject: `Order follow-up requested: ${order.orderNumber}`,
      description:
        `A customer asked our team to follow up on their order.\n` +
        `Order: ${order.orderNumber}\n` +
        `Order status: ${order.orderStatus ?? 'unknown'} · Payment: ${order.paymentStatus ?? 'unknown'}\n` +
        `Delivery area: ${order.deliveryArea || 'not given'}\n` +
        (note ? `\nCustomer note:\n${note}\n` : '') +
        `\nRaised from the Track Order page (contact verified).`,
      productModel: 'Order follow-up',
      email,
      // The phone on the order, never the one typed here: the ticket is
      // answered on the number the customer checked out with.
      phone: (order.customerPhone ?? '').trim() || (contact.includes('@') ? '' : contact),
      metadata: { source: 'track-order', orderReference: order.orderNumber, verifiedWith: contact.includes('@') ? 'email' : 'phone' },
    });
  }
}
