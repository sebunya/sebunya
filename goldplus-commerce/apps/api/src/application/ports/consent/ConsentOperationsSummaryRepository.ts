export interface ConsentOperationsCounters {
  totalEvents: number;
  grants: number;
  withdrawals: number;
  providerSuppressions: number;
  policyBlocks: number;
  duplicateLifecycleGroups: number;
  lastEventAt: string | null;
  providerCallbacks: number;
  providerUnsubscribes: number;
  outboxRows: number;
  notificationAttempts: number;
  transportCalls: number;
}

export interface ConsentOperationsSummaryRepository {
  readCounters(): Promise<ConsentOperationsCounters>;
}
