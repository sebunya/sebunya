/**
 * Ports for the "we have it" acknowledgement a public form sends back to the
 * contact typed on it (dealer application, quote, support issue, fake report,
 * order follow-up).
 */

export interface PublicFormAcknowledgementMessage {
  eventType: string;
  template: string;
  customerPhone: string | null;
  customerEmail: string | null;
  data: Record<string, unknown>;
  idempotencyKey: string;
  relatedEntity: string;
  relatedEntityId: string | null;
}

/** Puts one customer message on the transactional outbox (deduped on idempotencyKey). */
export interface IAcknowledgementOutbox {
  enqueue(input: PublicFormAcknowledgementMessage): Promise<'sent' | 'skipped'>;
}

/** Read side of the outbox, used only to enforce the per-recipient cap. */
export interface IAcknowledgementLedger {
  /**
   * How many acknowledgements were already queued for this recipient since
   * `since`. `keyPrefix` is the recipient part of the idempotency key, e.g.
   * `ack:tel:+256772123456:`.
   */
  countSince(keyPrefix: string, since: Date): Promise<number>;
}
