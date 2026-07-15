import { sql } from 'drizzle-orm';
import type {
  ConsentOperationsCounters,
  ConsentOperationsSummaryRepository,
} from '../../application/ports/consent/ConsentOperationsSummaryRepository';
import { db } from '../db/client';
import {
  channelSuppressions,
  consentEvents,
  consentPolicyBlocks,
  notificationAttempts,
  outboxEvents,
  providerUnsubscribeEvents,
} from '../db/schema';

const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export class DrizzleConsentOperationsSummaryRepository implements ConsentOperationsSummaryRepository {
  async readCounters(): Promise<ConsentOperationsCounters> {
    const duplicateGroups = db.select({
      marker: sql<number>`1`.as('marker'),
    }).from(consentEvents).groupBy(
      consentEvents.customerIdentityRef,
      consentEvents.purposeKey,
      consentEvents.channelKey,
      consentEvents.eventType,
      consentEvents.correlationId,
    ).having(sql`count(*) > 1`).as('duplicate_groups');

    const [ledgerRows, suppressionRows, policyRows, providerRows, outboxRows, notificationRows, duplicateRows] = await Promise.all([
      db.select({
        totalEvents: sql<number>`count(*)::int`,
        grants: sql<number>`count(*) filter (where ${consentEvents.eventType} = 'consent_grant_recorded')::int`,
        withdrawals: sql<number>`count(*) filter (where ${consentEvents.eventType} = 'consent_withdrawal_recorded')::int`,
        providerCallbacks: sql<number>`count(*) filter (where ${consentEvents.providerCallbackRef} is not null)::int`,
        lastEventAt: sql<Date | null>`max(${consentEvents.effectiveAt})`,
      }).from(consentEvents),
      db.select({ count: sql<number>`count(*)::int` }).from(channelSuppressions),
      db.select({ count: sql<number>`count(*)::int` }).from(consentPolicyBlocks),
      db.select({ count: sql<number>`count(*)::int` }).from(providerUnsubscribeEvents),
      db.select({ count: sql<number>`count(*)::int` }).from(outboxEvents),
      db.select({ count: sql<number>`count(*)::int` }).from(notificationAttempts),
      db.select({ count: sql<number>`count(*)::int` }).from(duplicateGroups),
    ]);

    const ledger = ledgerRows[0];
    const notifications = toNumber(notificationRows[0]?.count);
    const lastEvent = ledger?.lastEventAt;
    return Object.freeze({
      totalEvents: toNumber(ledger?.totalEvents),
      grants: toNumber(ledger?.grants),
      withdrawals: toNumber(ledger?.withdrawals),
      providerSuppressions: toNumber(suppressionRows[0]?.count),
      policyBlocks: toNumber(policyRows[0]?.count),
      duplicateLifecycleGroups: toNumber(duplicateRows[0]?.count),
      lastEventAt: lastEvent instanceof Date ? lastEvent.toISOString() : lastEvent ? String(lastEvent) : null,
      providerCallbacks: toNumber(ledger?.providerCallbacks),
      providerUnsubscribes: toNumber(providerRows[0]?.count),
      outboxRows: toNumber(outboxRows[0]?.count),
      notificationAttempts: notifications,
      transportCalls: notifications,
    });
  }
}
