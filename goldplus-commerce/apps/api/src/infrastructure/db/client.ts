import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { logger } from '../logging/logger';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('DATABASE_URL is not defined. Database connection will fail if used.');
}

export const client = postgres(connectionString || 'postgres://localhost:5432/goldplus', {
  max: 20,
  idle_timeout: 30, // seconds
  connect_timeout: 5, // connection timeout in seconds
  prepare: false,
  parameters: {
    statement_timeout: '5000', // statement timeout in milliseconds (5s)
  }
} as any);

import * as clientMetric from 'prom-client';

const dbQueriesActive = new clientMetric.Gauge({
  name: 'goldplus_db_queries_active',
  help: 'Number of active database queries',
});

const dbQueryDuration = new clientMetric.Histogram({
  name: 'goldplus_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const dbTransactionsActive = new clientMetric.Gauge({
  name: 'goldplus_db_transactions_active',
  help: 'Number of active database transactions',
});

const dbTransactionDuration = new clientMetric.Histogram({
  name: 'goldplus_db_transaction_duration_seconds',
  help: 'Database transaction duration in seconds',
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10],
});

// Helper to register metrics safely
const registerMetric = (m: clientMetric.Metric) => {
  try {
    clientMetric.register.registerMetric(m);
  } catch (err) {
    // ignore already registered
  }
};

registerMetric(dbQueriesActive);
registerMetric(dbQueryDuration);
registerMetric(dbTransactionsActive);
registerMetric(dbTransactionDuration);

export const dbQueryDurations: number[] = [];

// Wrap client.unsafe to log slow queries (>250ms) and track active queries
const originalUnsafe = client.unsafe.bind(client);
client.unsafe = function (query: string, parameters?: any[], type?: any) {
  const start = Date.now();
  dbQueriesActive.inc();
  const result = originalUnsafe(query, parameters, type);

  const trackDuration = (duration: number) => {
    dbQueryDurations.push(duration);
    if (dbQueryDurations.length > 50) {
      dbQueryDurations.shift();
    }
  };

  if (result && typeof result.then === 'function') {
    return result.then(
      (res: any) => {
        dbQueriesActive.dec();
        const duration = Date.now() - start;
        trackDuration(duration);
        dbQueryDuration.observe(duration / 1000);
        if (duration > 250) {
          logger.warn({ query, duration, parameters }, `[DB] Slow query detected (>250ms)`);
        }
        return res;
      },
      (err: any) => {
        dbQueriesActive.dec();
        const duration = Date.now() - start;
        trackDuration(duration);
        dbQueryDuration.observe(duration / 1000);
        if (duration > 250) {
          logger.warn({ query, duration, parameters, error: err.message }, `[DB] Slow query failed (>250ms)`);
        }
        throw err;
      }
    );
  }
  dbQueriesActive.dec();
  const duration = Date.now() - start;
  trackDuration(duration);
  return result;
} as any;

// Wrap client.begin to track database transaction durations and retry deadlocks/serialization failures
const originalBegin = client.begin.bind(client);
client.begin = function (options: any, cb: any) {
  const callback = typeof options === 'function' ? options : cb;
  const opts = typeof options === 'function' ? {} : options;
  const start = Date.now();

  dbTransactionsActive.inc();

  const wrappedCallback = async (sql: any) => {
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      try {
        attempts++;
        const res = await callback(sql);
        dbTransactionsActive.dec();
        const duration = Date.now() - start;
        dbTransactionDuration.observe(duration / 1000);
        if (duration > 1000) {
          logger.warn({ durationMs: duration, attempts }, '[DB] Long running database transaction committed (>1s)');
        }
        return res;
      } catch (err: any) {
        const code = err?.code || err?.statusCode || '';
        const isRetryable = code === '40001' || code === '40P01';

        if (isRetryable && attempts < maxAttempts) {
          const delay = Math.min(100 * Math.pow(2, attempts), 1000) + Math.floor(Math.random() * 100);
          logger.warn(
            { code, attempt: attempts, nextDelayMs: delay, error: err.message },
            '[DB] Transaction serialization or deadlock failure detected. Retrying transaction...'
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        dbTransactionsActive.dec();
        const duration = Date.now() - start;
        dbTransactionDuration.observe(duration / 1000);
        logger.warn({ durationMs: duration, attempts, err: err.message }, '[DB] Transaction rolled back/failed');
        throw err;
      }
    }
  };

  if (typeof options === 'function') {
    return originalBegin(wrappedCallback);
  } else {
    return originalBegin(opts, wrappedCallback);
  }
} as any;

export const db = drizzle(client, { schema });

export async function endDbConnection() {
  await client.end({ timeout: 5 });
  console.log('[DB] Database connection closed.');
}
