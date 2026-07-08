import { db } from '../db/client';
import { consentRecords, consentCurrentState } from '../db/schema/consent';
import { eq, and, desc } from 'drizzle-orm';
import type { ConsentRepository } from '../../application/ports/measurement/ConsentRepository';
import type { ConsentState, ConsentSignal, ConsentWithdrawal } from '@goldplus/shared';

export class DrizzleConsentRepository implements ConsentRepository {
  async recordSignal(signal: ConsentSignal, purposes: ConsentState, expiresAt: Date, ipAddress?: string, userAgent?: string): Promise<{ recordId: string }> {
    const key = signal.user_id ? { userId: signal.user_id } : { fpClientId: signal.fp_client_id };
    
    const [inserted] = await db.insert(consentRecords).values({
      fpClientId:      signal.fp_client_id,
      userId:          signal.user_id,
      purposes,
      grantType:       signal.grant_type,
      captureSurface:  signal.capture_surface,
      noticeVersion:   signal.notice_version,
      consentLanguage: signal.consent_language,
      ipAddress,
      userAgent,
      capturedAt:      new Date(),
    }).returning({ id: consentRecords.id });

    await db.insert(consentCurrentState).values({
      ...key,
      analyticsGranted:       purposes.analytics,
      advertisingGranted:     purposes.advertising,
      personalizationGranted: purposes.personalization,
      lastGrantType:          signal.grant_type,
      lastNoticeVersion:      signal.notice_version,
      lastConsentRecordId:    inserted.id,
      updatedAt:              new Date(),
      expiresAt,
    }).onConflictDoUpdate({
      target: signal.user_id ? consentCurrentState.userId : consentCurrentState.fpClientId,
      set: {
        analyticsGranted:       purposes.analytics,
        advertisingGranted:     purposes.advertising,
        personalizationGranted: purposes.personalization,
        lastGrantType:          signal.grant_type,
        lastNoticeVersion:      signal.notice_version,
        lastConsentRecordId:    inserted.id,
        updatedAt:              new Date(),
        expiresAt,
      },
    });

    return { recordId: inserted.id };
  }

  async recordWithdrawal(withdrawal: ConsentWithdrawal, updatedPurposes: ConsentState, ipAddress?: string, userAgent?: string): Promise<{ recordId: string }> {
    const key = withdrawal.user_id ? { userId: withdrawal.user_id } : { fpClientId: withdrawal.fp_client_id };

    const [inserted] = await db.insert(consentRecords).values({
      fpClientId:      withdrawal.fp_client_id,
      userId:          withdrawal.user_id,
      purposes:        updatedPurposes,
      grantType:       'withdrawn',
      captureSurface:  'privacy_settings',
      noticeVersion:   'v1.0',
      consentLanguage: 'en',
      ipAddress,
      userAgent,
      isWithdrawal:    true,
      withdrawnPurposes: withdrawal.purposes,
      capturedAt:      new Date(),
    }).returning({ id: consentRecords.id });

    await db.insert(consentCurrentState).values({
      ...key,
      analyticsGranted:       updatedPurposes.analytics,
      advertisingGranted:     updatedPurposes.advertising,
      personalizationGranted: updatedPurposes.personalization,
      lastGrantType:          'withdrawn',
      lastNoticeVersion:      'v1.0',
      lastConsentRecordId:    inserted.id,
      updatedAt:              new Date(),
    }).onConflictDoUpdate({
      target: withdrawal.user_id ? consentCurrentState.userId : consentCurrentState.fpClientId,
      set: {
        analyticsGranted:       updatedPurposes.analytics,
        advertisingGranted:     updatedPurposes.advertising,
        personalizationGranted: updatedPurposes.personalization,
        lastGrantType:          'withdrawn',
        lastConsentRecordId:    inserted.id,
        updatedAt:              new Date(),
      },
    });

    return { recordId: inserted.id };
  }

  async getCurrentState(fpClientId?: string, userId?: string): Promise<{ row: any | null }> {
    let row = null;
    if (userId) {
      [row] = await db.select().from(consentCurrentState)
        .where(eq(consentCurrentState.userId, userId))
        .limit(1);
    }
    if (!row && fpClientId) {
      [row] = await db.select().from(consentCurrentState)
        .where(eq(consentCurrentState.fpClientId, fpClientId))
        .limit(1);
    }
    return { row };
  }

  async getAuditTrail(fpClientId?: string, userId?: string, limit = 50): Promise<any[]> {
    const conditions = [];
    if (userId)     conditions.push(eq(consentRecords.userId, userId));
    if (fpClientId) conditions.push(eq(consentRecords.fpClientId, fpClientId));

    if (conditions.length === 0) return [];

    return db.select().from(consentRecords)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(desc(consentRecords.createdAt))
      .limit(limit);
  }
}
