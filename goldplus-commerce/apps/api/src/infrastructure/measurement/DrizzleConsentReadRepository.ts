import { db } from '../db/client';
import { consentRecords } from '../db/schema/consent';
import { desc } from 'drizzle-orm';
import type { ConsentReadRepository } from '../../application/ports/measurement/ConsentReadRepository';

export class DrizzleConsentReadRepository implements ConsentReadRepository {
  async listAuditTrail(limit: number): Promise<any[]> {
    return await db
      .select()
      .from(consentRecords)
      .orderBy(desc(consentRecords.createdAt))
      .limit(limit);
  }
}
