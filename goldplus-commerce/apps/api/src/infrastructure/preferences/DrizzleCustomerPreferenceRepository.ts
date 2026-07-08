import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { customerPreferences } from '../db/schema/preferences';
import { CustomerPreferenceRepository, CustomerPreferenceModel } from '../../application/ports/preferences/CustomerPreferenceRepository';

export class DrizzleCustomerPreferenceRepository implements CustomerPreferenceRepository {
  async getPreferences(userId: string): Promise<CustomerPreferenceModel | null> {
    const row = await db.select().from(customerPreferences).where(eq(customerPreferences.userId, userId)).limit(1);
    if (!row.length) return null;

    const r = row[0];
    return {
      userId: r.userId,
      channels: r.channels as any,
      topics: r.topics as any,
      interests: r.interests as any,
      intent: r.intent as any,
      updatedAt: r.updatedAt
    };
  }

  async upsertPreferences(userId: string, data: Omit<CustomerPreferenceModel, 'updatedAt'>): Promise<CustomerPreferenceModel> {
    const rows = await db.insert(customerPreferences).values({
      userId: data.userId,
      channels: data.channels,
      topics: data.topics,
      interests: data.interests,
      intent: data.intent,
    }).onConflictDoUpdate({
      target: customerPreferences.userId,
      set: {
        channels: data.channels,
        topics: data.topics,
        interests: data.interests,
        intent: data.intent,
        updatedAt: new Date(),
      }
    }).returning();

    const r = rows[0];
    return {
      userId: r.userId,
      channels: r.channels as any,
      topics: r.topics as any,
      interests: r.interests as any,
      intent: r.intent as any,
      updatedAt: r.updatedAt
    };
  }
}
