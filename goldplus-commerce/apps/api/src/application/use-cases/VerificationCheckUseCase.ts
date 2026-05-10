import { DrizzleVerificationRepository } from '../../infrastructure/db/repositories/DrizzleVerificationRepository';
import { VerificationAttempt } from '../../domain/verification/VerificationAttempt';
import * as nodeCrypto from 'node:crypto';


export class VerificationCheckUseCase {
  constructor(private readonly verificationRepo: DrizzleVerificationRepository) {}

  public async execute(code: string, ipAddress?: string, userAgent?: string): Promise<{ success: boolean; productId?: string }> {
    const codeInfo = await this.verificationRepo.findCode(code);
    
    const isSuccessful = !!codeInfo && !codeInfo.isUsed;
    const productId = codeInfo?.productId || null;

    const attempt = VerificationAttempt.record(
      nodeCrypto.randomUUID(),

      code,
      productId,
      isSuccessful,
      ipAddress || null,
      userAgent || null
    );

    await this.verificationRepo.saveAttempt(attempt);

    if (isSuccessful) {
      await this.verificationRepo.markCodeAsUsed(code);
      return { success: true, productId: productId! };
    }

    return { success: false };
  }
}
