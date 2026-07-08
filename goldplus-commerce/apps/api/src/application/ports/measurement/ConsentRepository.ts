import type { ConsentState, ConsentSignal, ConsentWithdrawal } from '@goldplus/shared';

export interface ConsentRepository {
  recordSignal(signal: ConsentSignal, purposes: ConsentState, expiresAt: Date, ipAddress?: string, userAgent?: string): Promise<{ recordId: string }>;
  recordWithdrawal(withdrawal: ConsentWithdrawal, updatedPurposes: ConsentState, ipAddress?: string, userAgent?: string): Promise<{ recordId: string }>;
  getCurrentState(fpClientId?: string, userId?: string): Promise<{ row: any | null }>;
  getAuditTrail(fpClientId?: string, userId?: string, limit?: number): Promise<any[]>;
}
