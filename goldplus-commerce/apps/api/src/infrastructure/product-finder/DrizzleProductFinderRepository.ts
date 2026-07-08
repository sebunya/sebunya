import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { productFinderSessions } from '../db/schema/product_finder';
import { ProductFinderRepository, ProductFinderSession } from '../../application/ports/product-finder/ProductFinderRepository';

export class DrizzleProductFinderRepository implements ProductFinderRepository {
  async createSession(params: { userId?: string; anonymousId?: string; status: string }): Promise<ProductFinderSession> {
    const [row] = await db.insert(productFinderSessions).values({
      userId: params.userId || null,
      anonymousId: params.anonymousId || null,
      status: params.status,
      answers: {},
      recommendations: []
    }).returning();

    return this.mapToDomain(row);
  }

  async updateSessionAnswers(sessionId: string, answers: Record<string, string | string[]>): Promise<void> {
    await db.update(productFinderSessions)
      .set({ answers, updatedAt: new Date() })
      .where(eq(productFinderSessions.id, sessionId));
  }

  async completeSession(sessionId: string, recommendations: any[], status: string): Promise<void> {
    await db.update(productFinderSessions)
      .set({ recommendations, status, updatedAt: new Date() })
      .where(eq(productFinderSessions.id, sessionId));
  }

  async getSession(sessionId: string): Promise<ProductFinderSession | null> {
    const row = await db.query.productFinderSessions.findFirst({
      where: eq(productFinderSessions.id, sessionId)
    });
    return row ? this.mapToDomain(row) : null;
  }

  async listRecentSessionsForCustomer(userId: string): Promise<ProductFinderSession[]> {
    const rows = await db.query.productFinderSessions.findMany({
      where: eq(productFinderSessions.userId, userId),
      orderBy: [desc(productFinderSessions.createdAt)],
      limit: 10
    });
    return rows.map(this.mapToDomain);
  }

  private mapToDomain(row: any): ProductFinderSession {
    return {
      id: row.id,
      userId: row.userId,
      anonymousId: row.anonymousId,
      status: row.status,
      answers: row.answers,
      recommendations: row.recommendations,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
