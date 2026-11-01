import type {
  IAcknowledgementLedger,
  IAcknowledgementOutbox,
} from '../../ports/IPublicFormAcknowledgement';
import {
  acknowledgementIdempotencyKey,
  acknowledgementKeyPrefix,
  acknowledgementRecipient,
} from './AcknowledgementIdempotency';

/**
 * At most this many acknowledgements reach one recipient (phone or email) in
 * any rolling 24 hours, across every public form. With the hourly key that is
 * one per hour AND at most three a day: enough for a real customer who files a
 * quote, a support issue and a follow-up, too few to pump SMS or email credit.
 */
export const ACKNOWLEDGEMENTS_PER_RECIPIENT_PER_DAY = 3;

export type AcknowledgementOutcome = 'queued' | 'no_contact' | 'daily_cap_reached' | 'skipped';

export interface SendPublicFormAcknowledgementInput {
  kind: string;
  eventType: string;
  template: string;
  phone: unknown;
  email: unknown;
  data: Record<string, unknown>;
  entityId: string;
  relatedEntity: string;
}

/**
 * The one path a public form's "we have it" message takes to the outbox.
 *
 * The form's own row is always saved (the team sees every submission); this
 * decides only whether the CONTACT is messaged. The hourly idempotency key
 * collapses repeats within an hour (the outbox ignores a duplicate key), and
 * the daily ceiling is counted from the recipient's earlier keys. A ledger
 * read failure fails CLOSED: no message is better than an uncapped one.
 */
export class SendPublicFormAcknowledgementUseCase {
  constructor(
    private readonly outbox: IAcknowledgementOutbox,
    private readonly ledger: IAcknowledgementLedger,
    private readonly clock: () => Date = () => new Date(),
    private readonly dailyCap: number = ACKNOWLEDGEMENTS_PER_RECIPIENT_PER_DAY,
  ) {}

  async execute(input: SendPublicFormAcknowledgementInput): Promise<AcknowledgementOutcome> {
    const recipient = acknowledgementRecipient({ phone: input.phone, email: input.email });
    if (!recipient) return 'no_contact';
    const now = this.clock();
    const idempotencyKey = acknowledgementIdempotencyKey({
      kind: input.kind,
      phone: input.phone,
      email: input.email,
      entityId: input.entityId,
      now,
    });

    // Includes the current hour's key when it already exists; the insert below
    // is then a no-op anyway, so counting it cannot wrongly refuse a new hour.
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const already = await this.ledger.countSince(acknowledgementKeyPrefix(recipient), since);
    if (already >= this.dailyCap) return 'daily_cap_reached';

    const phone = typeof input.phone === 'string' && input.phone.trim() ? input.phone : null;
    const email = typeof input.email === 'string' && input.email.trim() ? input.email : null;
    const result = await this.outbox.enqueue({
      eventType: input.eventType,
      template: input.template,
      customerPhone: phone,
      customerEmail: email,
      data: input.data,
      idempotencyKey,
      relatedEntity: input.relatedEntity,
      relatedEntityId: input.entityId,
    });
    return result === 'sent' ? 'queued' : 'skipped';
  }
}
