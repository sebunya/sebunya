import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { FraudSourceDirectoryPort } from '../../../application/use-cases/fraud/FraudTriageOperationsUseCase';
import type { FraudSourceType } from '../../../domain/fraud/FraudTriage';

/**
 * Resolves a fraud signal's sourceRef against the record it names:
 *   ORDER    -> orders.id or orders.order_number
 *   PAYMENT  -> payments.id or payments.provider_reference (the provider's tracking id)
 *   CHECKOUT -> checkout_idempotency.identity (the checkout attempt)
 *   IDENTITY -> users.id
 * Ids are compared as text so a non-UUID reference is simply "not found",
 * never a Postgres cast error.
 */
export class DrizzleFraudSourceDirectory implements FraudSourceDirectoryPort {
  async exists(sourceType: FraudSourceType, sourceRef: string): Promise<boolean> {
    const ref = sourceRef.trim();
    if (!ref) return false;
    const query = (() => {
      switch (sourceType) {
        case 'ORDER': return sql`select 1 from orders where id::text = ${ref} or order_number = ${ref} limit 1`;
        case 'PAYMENT': return sql`select 1 from payments where id::text = ${ref} or provider_reference = ${ref} limit 1`;
        case 'CHECKOUT': return sql`select 1 from checkout_idempotency where identity = ${ref} limit 1`;
        case 'IDENTITY': return sql`select 1 from users where id::text = ${ref} limit 1`;
        default: return null;
      }
    })();
    if (!query) return false;
    const rows = await db.execute(query);
    return (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []).length > 0;
  }
}
