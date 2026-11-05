import { DrizzleVerificationRepository } from '../../infrastructure/db/repositories/DrizzleVerificationRepository';
import { VerificationAttempt } from '../../domain/verification/VerificationAttempt';
import * as nodeCrypto from 'node:crypto';

/**
 * Hologram code check. Codes are single use: the FIRST check of a registered
 * code marks it used and answers `genuine`. A later check of the same code
 * answers `already_checked` with the time of the first check. That is NOT a
 * counterfeit verdict (the code is registered); it may be the buyer's own
 * earlier check, a retry after a timeout, or a package opened before sale.
 * `not_found` means the code is not in our register (mistyped or not ours).
 */
export type VerificationStatus = 'genuine' | 'already_checked' | 'not_found';

export interface VerificationCheckResult {
  success: boolean;
  status: VerificationStatus;
  productId?: string;
  firstCheckedAt?: string | null;
}

/** Codes are stored as varchar(50): a longer value (or control characters) can never match and used to fail the attempt insert with a 500. */
// eslint-disable-next-line no-control-regex -- deliberately refuses control characters
export const VERIFICATION_CODE_PATTERN = /^[^\u0000-\u001f\u007f]{1,50}$/;

type Repo = Pick<DrizzleVerificationRepository, 'claimCode' | 'findCode' | 'saveAttempt'>;

export class VerificationCheckUseCase {
  constructor(private readonly verificationRepo: Repo) {}

  public async execute(code: string, ipAddress?: string, userAgent?: string, userId?: string | null): Promise<VerificationCheckResult> {
    // Claim first (atomic), then classify a miss. A concurrent double click
    // yields one `genuine` and one `already_checked`, never two claims.
    const claimed = await this.verificationRepo.claimCode(code);
    let result: VerificationCheckResult;
    if (claimed) {
      result = { success: true, status: 'genuine', productId: claimed.productId };
    } else {
      const info = await this.verificationRepo.findCode(code);
      result = info
        ? { success: false, status: 'already_checked', productId: info.productId, firstCheckedAt: info.usedAt ? new Date(info.usedAt).toISOString() : null }
        : { success: false, status: 'not_found' };
    }

    // isSuccessful stays "this check claimed a genuine code": the admin
    // summary and the "verify ten" mission count exactly that.
    const attempt = VerificationAttempt.record(
      nodeCrypto.randomUUID(),
      code,
      result.productId ?? null,
      result.success,
      ipAddress || null,
      userAgent || null,
      userId ?? null,
    );
    await this.verificationRepo.saveAttempt(attempt);
    return result;
  }
}
