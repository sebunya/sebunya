/**
 * Write side of the transactional outbox. Kept separate from
 * IOutboxRepository (the processor's claim/ack interface) so producers
 * only depend on what they use.
 */
export interface IOutboxWriter {
  append(eventType: string, payload: Record<string, unknown>): Promise<void>;
}
