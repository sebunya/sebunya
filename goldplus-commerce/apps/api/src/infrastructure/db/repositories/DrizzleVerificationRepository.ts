import { db } from '../client';
import { verificationCodes, verificationAttempts } from '../schema/system';
import { eq, and } from 'drizzle-orm';
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
}
