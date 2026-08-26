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
export class CustomerOutboxNotifier {
  async enqueue(input: {
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
  }): Promise<'sent' | 'skipped'> {
    const phone = (input.customerPhone || '').trim();
    const email = (input.customerEmail || '').trim();
    if (!phone && !email) return 'skipped';

    const message = smsText(input.template, input.data as never);
    const copy = emailCopy(input.template, input.data as never);
    // A template with no customer wording is a programming error, not a
    // message. Refuse loudly rather than let the key reach a phone.
    if (!message && !copy) {
      throw new Error(`CustomerOutboxNotifier: no customer wording for template ${input.template}`);
    }

    await db
      .insert(outboxEvents)
      .values({
        eventType: input.eventType,
        payload: {
          ...input.data,
          message: message ?? undefined,
          customerPhone: phone || null,
          customerEmail: email || null,
        } as never,
        idempotencyKey: input.idempotencyKey,
        status: 'pending',
        channel: phone ? 'sms' : 'email',
        template: input.template,
        dryRunOnly: input.dryRunOnly === true,
        relatedEntity: input.relatedEntity,
        relatedEntityId: input.relatedEntityId,
      })
      .onConflictDoNothing({ target: outboxEvents.idempotencyKey });
    return 'sent';
  }
}
