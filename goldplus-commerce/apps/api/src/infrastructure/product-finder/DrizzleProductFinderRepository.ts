import { and, desc, eq, sql } from "drizzle-orm";
import { client, db } from "../db/client";
import { productFinderSessions } from "../db/schema/product_finder";
import {
  ProductFinderRepository,
  ProductFinderSession,
} from "../../application/ports/product-finder/ProductFinderRepository";

const jsonb = (value: unknown) => sql`${client.json(value as any)}::jsonb`;

export class DrizzleProductFinderRepository implements ProductFinderRepository {
  async createSession(params: {
    userId?: string;
    anonymousId?: string;
    status: string;
  }): Promise<ProductFinderSession> {
    const [row] = await db
      .insert(productFinderSessions)
      .values({
        userId: params.userId || null,
        anonymousId: params.anonymousId || null,
        status: params.status,
        answers: jsonb({}) as any,
        recommendations: jsonb([]) as any,
      })
      .returning();

    return this.mapToDomain(row);
  }

  async updateSessionAnswer(
    sessionId: string,
    stepId: string,
    answer: string,
  ): Promise<boolean> {
    const updated = await db
      .update(productFinderSessions)
      .set({
        answers: sql`${productFinderSessions.answers} || ${jsonb({ [stepId]: answer })}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productFinderSessions.id, sessionId),
          eq(productFinderSessions.status, "FINDER_STARTED"),
        ),
      )
      .returning({ id: productFinderSessions.id });
    return updated.length === 1;
  }

  async completeSession(
    sessionId: string,
    recommendations: any[],
    status: string,
  ): Promise<boolean> {
    const updated = await db
      .update(productFinderSessions)
      .set({
        recommendations: jsonb(recommendations) as any,
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productFinderSessions.id, sessionId),
          eq(productFinderSessions.status, "FINDER_STARTED"),
        ),
      )
      .returning({ id: productFinderSessions.id });
    return updated.length === 1;
  }

  async getSession(sessionId: string): Promise<ProductFinderSession | null> {
    const row = await db.query.productFinderSessions.findFirst({
      where: eq(productFinderSessions.id, sessionId),
    });
    return row ? this.mapToDomain(row) : null;
  }

  async listRecentSessionsForCustomer(
    userId: string,
  ): Promise<ProductFinderSession[]> {
    const rows = await db.query.productFinderSessions.findMany({
      where: eq(productFinderSessions.userId, userId),
      orderBy: [desc(productFinderSessions.createdAt)],
      limit: 10,
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
      updatedAt: row.updatedAt,
    };
  }
}
