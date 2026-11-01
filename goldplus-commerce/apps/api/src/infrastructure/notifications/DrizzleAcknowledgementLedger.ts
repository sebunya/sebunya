import { and, gte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { outboxEvents } from '../db/schema/system';
import type { IAcknowledgementLedger } from '../../application/ports/IPublicFormAcknowledgement';

/** Escape LIKE metacharacters so an email with `_` or `%` matches only itself. */
export function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Counts a recipient's public-form acknowledgements already on the outbox.
 * Every acknowledgement key starts `ack:<recipient>:` (AcknowledgementIdempotency),
 * so the recipient's history is a prefix match on the existing key column.
 */
export class DrizzleAcknowledgementLedger implements IAcknowledgementLedger {
  async countSince(keyPrefix: string, since: Date): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .where(and(
        sql`${outboxEvents.idempotencyKey} like ${likePrefix(keyPrefix)}`,
        gte(outboxEvents.createdAt, since),
      ));
    return Number(rows[0]?.n ?? 0);
  }
}
