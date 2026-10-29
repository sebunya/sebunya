import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { productQuestions } from '../db/schema/questions';
import { products } from '../db/schema/products';
import type { IProductQuestionRepository, ProductQuestionRow, PublicQuestion, QuestionStatus } from '../../application/use-cases/questions/ProductQuestionUseCases';
import { REMOVED_TEXT } from '../../domain/first-party/PrivacyRequests';

const row = (r: typeof productQuestions.$inferSelect & { productName?: string | null; productSlug?: string | null }): ProductQuestionRow => ({
  id: r.id, productId: r.productId, askerName: r.askerName, askerPhone: r.askerPhone, askerEmail: r.askerEmail, question: r.question,
  status: r.status as QuestionStatus, answer: r.answer, answeredAt: r.answeredAt, createdAt: r.createdAt, productName: r.productName ?? null, productSlug: r.productSlug ?? null,
});

export class DrizzleProductQuestionRepository implements IProductQuestionRepository {
  async productExists(productId: string) {
    const [p] = await db.select({ name: products.name, slug: products.slug }).from(products).where(eq(products.id, productId)).limit(1);
    return p ? { name: p.name, slug: p.slug } : null;
  }

  async countAskedSince(askerIdentityHash: string, since: Date) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(productQuestions).where(and(eq(productQuestions.askerIdentityHash, askerIdentityHash), gte(productQuestions.createdAt, since)));
    return Number(r?.n ?? 0);
  }

  async countAllAskedSince(since: Date) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(productQuestions).where(gte(productQuestions.createdAt, since));
    return Number(r?.n ?? 0);
  }

  async insert(input: { productId: string; askerIdentityHash: string; askerName: string; askerPhone: string | null; askerEmail: string | null; question: string }) {
    const [r] = await db.insert(productQuestions).values(input).returning({ id: productQuestions.id });
    return { id: r!.id };
  }

  async listAnswered(productId: string, limit: number): Promise<PublicQuestion[]> {
    const rows = await db.select().from(productQuestions).where(and(eq(productQuestions.productId, productId), eq(productQuestions.status, 'answered')))
      .orderBy(desc(productQuestions.answeredAt)).limit(limit);
    // An asker erased at their request (DrizzlePersonalDataEraser) is shown as "a customer", not as the removal notice.
    return rows.filter((r) => r.answer && r.answeredAt).map((r) => ({ id: r.id, askerName: r.askerName === REMOVED_TEXT ? 'a customer' : r.askerName, question: r.question, answer: r.answer as string, answeredAt: (r.answeredAt as Date).toISOString() }));
  }

  async listByStatus(status: QuestionStatus, limit: number) {
    const rows = await db.select({ q: productQuestions, productName: products.name, productSlug: products.slug }).from(productQuestions)
      .innerJoin(products, eq(products.id, productQuestions.productId)).where(eq(productQuestions.status, status))
      .orderBy(status === 'pending' ? productQuestions.createdAt : desc(productQuestions.updatedAt)).limit(limit);
    return rows.map((r) => row({ ...r.q, productName: r.productName, productSlug: r.productSlug }));
  }

  async countByStatus() {
    const rows = await db.select({ status: productQuestions.status, n: sql<number>`count(*)::int` }).from(productQuestions).groupBy(productQuestions.status);
    const out: Record<QuestionStatus, number> = { pending: 0, answered: 0, rejected: 0 };
    for (const r of rows) if (r.status in out) out[r.status as QuestionStatus] = Number(r.n);
    return out;
  }

  async byId(id: string) {
    const [r] = await db.select({ q: productQuestions, productName: products.name, productSlug: products.slug }).from(productQuestions)
      .innerJoin(products, eq(products.id, productQuestions.productId)).where(eq(productQuestions.id, id)).limit(1);
    return r ? row({ ...r.q, productName: r.productName, productSlug: r.productSlug }) : null;
  }

  async answer(input: { id: string; answer: string; answeredBy: string; now: Date }) {
    const r = await db.update(productQuestions).set({ status: 'answered', answer: input.answer, answeredBy: input.answeredBy, answeredAt: input.now, updatedAt: input.now })
      .where(and(eq(productQuestions.id, input.id), sql`${productQuestions.status} <> 'answered'`)).returning({ id: productQuestions.id });
    return r.length > 0;
  }

  async reject(id: string, by: string, now: Date) {
    const r = await db.update(productQuestions).set({ status: 'rejected', answeredBy: by, updatedAt: now }).where(eq(productQuestions.id, id)).returning({ id: productQuestions.id });
    return r.length > 0;
  }

  async markNotified(id: string, now: Date) { await db.update(productQuestions).set({ notifiedAt: now }).where(eq(productQuestions.id, id)); }
}
