import { db } from '../db/client';
import { outboxEvents } from '../db/schema/system';
import { smsText, emailCopy } from '../../application/notifications/CustomerMessages';

/**
 * Enqueue a message to a CUSTOMER through the existing transactional outbox.
 *
 * One path for every customer message that is not a loyalty event or an OTP
 * (those have their own notifiers with the same shape). SMS goes first because
 * it is the channel that delivers in this market; email is the fallback when
 * there is no phone. Delivery is still governed downstream by the same gates
 * as every other customer message, so an enqueue can never bypass consent or
 * the live-send switch.
 *
 * The message BODY is attached here, from CustomerMessages, so no adapter can
 * ever fall back to sending the template's name as the text.
 */
export interface CustomerOutboxInput {
  eventType: string;
  template: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  data: Record<string, unknown>;
  idempotencyKey: string;
  relatedEntity: string;
  relatedEntityId: string | null;
  /** Registry-deferred order messages stay DRY_RUN until the owner switches them on. */
  dryRunOnly?: boolean;
}

/**
 * The outbox row for a customer message, or null when there is nobody to send it to. Shared with writers that must
 * insert the message inside their own transaction (a gift card and the text carrying its code, 0199).
 */
export function customerOutboxValues(input: CustomerOutboxInput): typeof outboxEvents.$inferInsert | null {
  const phone = (input.customerPhone || '').trim();
  const email = (input.customerEmail || '').trim();
  if (!phone && !email) return null;

  const message = smsText(input.template, input.data as never);
  const copy = emailCopy(input.template, input.data as never);
  // A template with no customer wording is a programming error, not a
  // message. Refuse loudly rather than let the key reach a phone.
  if (!message && !copy) {
    throw new Error(`CustomerOutboxNotifier: no customer wording for template ${input.template}`);
  }

  return {
    eventType: input.eventType,
    payload: {
      ...input.data,
      message: message ?? undefined,
      customerPhone: phone || null,
      customerEmail: email || null,
      // The router reads the order reference from the payload; on the row alone it was lost, and every customer
      // message was logged against no order (found tracing GP-202610-951E39E8's receipt, 2026-10-16).
      relatedEntity: input.relatedEntity,
      relatedEntityId: input.relatedEntityId,
      // The router decides dry-run from the PAYLOAD (it never reads the row column), so the
      // CUSTOMER_ORDER_MESSAGES_LIVE=false switch did nothing until it travelled here too (2026-10-22).
      dryRunOnly: input.dryRunOnly === true,
    } as never,
    idempotencyKey: input.idempotencyKey,
    status: 'pending',
    channel: phone ? 'sms' : 'email',
    template: input.template,
    dryRunOnly: input.dryRunOnly === true,
    relatedEntity: input.relatedEntity,
    relatedEntityId: input.relatedEntityId,
  };
}

export class CustomerOutboxNotifier {
  async enqueue(input: CustomerOutboxInput): Promise<'sent' | 'skipped'> {
    const values = customerOutboxValues(input);
    if (!values) return 'skipped';
    await db.insert(outboxEvents).values(values).onConflictDoNothing({ target: outboxEvents.idempotencyKey });
    return 'sent';
  }
}
