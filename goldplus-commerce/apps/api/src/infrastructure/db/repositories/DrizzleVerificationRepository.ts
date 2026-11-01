import { db } from '../client';
import { verificationCodes, verificationAttempts } from '../schema/system';
import { eq, and, gte, sql, desc, isNotNull } from 'drizzle-orm';
import { products } from '../schema/products';
import { VerificationAttempt } from '../../../domain/verification/VerificationAttempt';

export class DrizzleVerificationRepository {
  async findCode(code: string): Promise<{ productId: string; isUsed: boolean } | null> {
    const result = await db.query.verificationCodes.findFirst({
      where: eq(verificationCodes.code, code),
    });

    if (!result) return null;

    return {
      productId: result.productId,
      isUsed: result.isUsed,
    };
  }

  async saveAttempt(attempt: VerificationAttempt): Promise<void> {
    await db.insert(verificationAttempts).values({
      id: attempt.id,
      code: attempt.code,
      productId: attempt.productId,
      isSuccessful: attempt.isSuccessful,
      ipAddress: attempt.ipAddress,
      userAgent: attempt.userAgent,
      // The "verify ten products" mission counts attempts by user_id.
      userId: attempt.userId,
      createdAt: attempt.createdAt,
    });
  }

  async markCodeAsUsed(code: string): Promise<void> {
    await db.update(verificationCodes)
      .set({ isUsed: true, usedAt: new Date() })
      .where(eq(verificationCodes.code, code));
  }

  /**
   * Admin read (authenticity centre): counts over a window, never the scanner's
   * IP, user agent or account. A successful attempt is a genuine code; every
   * other attempt is "not genuine or unknown" — the table cannot tell apart a
   * mistyped code from a counterfeit one, so the page must not claim to.
   */
  async summarizeAttempts(since: Date, topLimit = 5): Promise<VerificationScanSummary> {
    const [totals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        genuine: sql<number>`count(*) filter (where ${verificationAttempts.isSuccessful})::int`,
      })
      .from(verificationAttempts)
      .where(gte(verificationAttempts.createdAt, since));
    const top = await db
      .select({
        productId: verificationAttempts.productId,
        productName: products.name,
        scans: sql<number>`count(*)::int`,
      })
      .from(verificationAttempts)
      .leftJoin(products, eq(products.id, verificationAttempts.productId))
      .where(and(gte(verificationAttempts.createdAt, since), isNotNull(verificationAttempts.productId)))
      .groupBy(verificationAttempts.productId, products.name)
      .orderBy(desc(sql`count(*)`))
      .limit(topLimit);
    const total = Number(totals?.total ?? 0);
    const genuine = Number(totals?.genuine ?? 0);
    return {
      since: since.toISOString(),
      total,
      genuine,
      notGenuineOrUnknown: total - genuine,
      topProducts: top.map((r) => ({ productId: r.productId as string, productName: r.productName ?? null, scans: Number(r.scans) })),
    };
  }
}

export interface VerificationScanSummary {
  since: string;
  total: number;
  genuine: number;
  notGenuineOrUnknown: number;
  topProducts: Array<{ productId: string; productName: string | null; scans: number }>;
}
