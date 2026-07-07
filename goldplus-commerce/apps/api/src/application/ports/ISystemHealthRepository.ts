export interface SystemHealthMetrics {
  postgresLatencyMs?: number;
  dbSaturation?: {
    activeConnections: number;
    maxConnections: number;
    status: 'healthy' | 'warning';
  };
  dbAdditionalMetrics?: {
    idleInTransactionConnections: number;
    lockWaitingQueries: number;
    preparedStatementsCount: number;
    walSizeBytes: number;
    activeReplicationStandbys: number;
  };
  outboxLagMs?: number;
  postgresError?: string;
}

export interface ISystemHealthRepository {
  getHealthMetrics(): Promise<SystemHealthMetrics>;
}
