import { ISystemHealthRepository, SystemHealthMetrics } from '../../../application/ports/ISystemHealthRepository';
import { db } from '../client';
import { sql } from 'drizzle-orm';
import { logger } from '../../logging/logger';

export class DrizzleSystemHealthRepository implements ISystemHealthRepository {
  async getHealthMetrics(): Promise<SystemHealthMetrics> {
    const startDb = Date.now();
    try {
      // 1. Basic query check and latency
      await db.execute(sql`SELECT 1`);
      const postgresLatencyMs = Date.now() - startDb;

      // 2. Db Saturation Analysis
      const connStats = await db.execute(sql`
        SELECT 
          (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) as active,
          (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max
      `);
      const active = connStats[0]?.active ? Number(connStats[0].active) : 0;
      const max = connStats[0]?.max ? Number(connStats[0].max) : 100;
      const saturationStatus = (active / max) > 0.8 ? 'warning' : 'healthy';

      // 2b. Query Additional Resiliency Metrics (Defensively isolated)
      let idleInTx = 0;
      let lockWaiting = 0;
      let prepStatements = 0;
      let walSize = 0;
      let activeReplicas = 0;

      try {
        const adminStats = await db.execute(sql`
          SELECT
            (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'idle in transaction') as idle_in_tx,
            (SELECT count(*)::int FROM pg_stat_activity WHERE wait_event_type = 'Lock') as lock_waiting
        `);
        idleInTx = Number(adminStats[0]?.idle_in_tx || 0);
        lockWaiting = Number(adminStats[0]?.lock_waiting || 0);
      } catch (e) {
        logger.debug({ err: e }, '[DrizzleSystemHealthRepository] Failed to query pg_stat_activity stats');
      }

      try {
        const prepStats = await db.execute(sql`SELECT count(*)::int as count FROM pg_prepared_statements`);
        prepStatements = Number(prepStats[0]?.count || 0);
      } catch (e) {
        logger.debug({ err: e }, '[DrizzleSystemHealthRepository] Failed to query pg_prepared_statements');
      }

      try {
        const repStats = await db.execute(sql`SELECT count(*)::int as count FROM pg_stat_replication`);
        activeReplicas = Number(repStats[0]?.count || 0);
      } catch (e) {
        logger.debug({ err: e }, '[DrizzleSystemHealthRepository] Failed to query pg_stat_replication');
      }

      try {
        const walStats = await db.execute(sql`
          SELECT pg_wal_lsn_diff(COALESCE(
            CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn() ELSE pg_current_wal_lsn() END,
            '0/0'::pg_lsn
          ), '0/0'::pg_lsn)::numeric as wal_lsn
        `);
        walSize = Number(walStats[0]?.wal_lsn || 0);
      } catch (e) {
        logger.debug({ err: e }, '[DrizzleSystemHealthRepository] Failed to query WAL size');
      }

      // 3. Outbox Lag Analysis
      const result = await db.execute(sql`
        SELECT min(created_at) as min_created_at 
        FROM outbox_events 
        WHERE is_processed = false
      `);
      const row = result[0];
      const minCreatedAt = row?.min_created_at ? new Date(row.min_created_at as string) : null;
      const outboxLagMs = minCreatedAt ? Date.now() - minCreatedAt.getTime() : 0;

      return {
        postgresLatencyMs,
        dbSaturation: {
          activeConnections: active,
          maxConnections: max,
          status: saturationStatus as 'healthy' | 'warning',
        },
        dbAdditionalMetrics: {
          idleInTransactionConnections: idleInTx,
          lockWaitingQueries: lockWaiting,
          preparedStatementsCount: prepStatements,
          walSizeBytes: walSize,
          activeReplicationStandbys: activeReplicas,
        },
        outboxLagMs,
      };
    } catch (err: any) {
      logger.error({ err }, '[DrizzleSystemHealthRepository] Health checks failed');
      return {
        postgresError: err.message || String(err),
      };
    }
  }
}
