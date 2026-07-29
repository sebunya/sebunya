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

// Wrap client.unsafe to log slow queries (>250ms) and track active queries.
//
// Slice 10-E (root cause of the failed 10-D deployment): the previous wrapper
// called `.then()` on the postgres-js Query eagerly, which both triggered
// execution and replaced the Query with a plain Promise — stripping the
// chainable API (`.values()`, `.simple()`) that drizzle-orm invokes as
// `client.unsafe(...).values()`. Every db.select() then crashed with
// "client.unsafe(...).values is not a function" (the exact production
// incident that forced the 10-D rollback). The wrapper now returns the SAME
// Query object and instruments it by intercepting `.then`, so execution stays
// lazy and every chainable method keeps working.
const originalUnsafe = client.unsafe.bind(client);
client.unsafe = function (query: string, parameters?: any[], type?: any) {
  const q: any = originalUnsafe(query, parameters, type);
  if (!q || typeof q.then !== 'function') return q;

  const trackDuration = (duration: number) => {
    dbQueryDurations.push(duration);
    if (dbQueryDurations.length > 50) {
      dbQueryDurations.shift();
    }
  };

  let started = 0;
  let settled = false;
  const onSettle = (err?: any) => {
    if (settled) return;
    settled = true;
    dbQueriesActive.dec();
    const duration = Date.now() - started;
    trackDuration(duration);
    dbQueryDuration.observe(duration / 1000);
    if (duration > 250) {
      // Parameter VALUES are deliberately not logged. A slow query is very often
      // a customer lookup, so the bound parameters are the customer's email,
      // phone, name or address — copied into log storage that is retained far
      // longer than the request and read by people with no need to see them.
      // The statement text and the parameter COUNT are enough to identify which
      // query is slow, which is what this line is for.
      logger.warn(
        {
          query,
          duration,
          parameterCount: Array.isArray(parameters) ? parameters.length : 0,
          ...(err ? { error: err.message } : {}),
        },
        `[DB] Slow query ${err ? 'failed' : 'detected'} (>250ms)`
      );
    }
  };

  const originalThen = q.then.bind(q);
  q.then = function (onFulfilled?: any, onRejected?: any) {
    if (started === 0) {
      started = Date.now();
      dbQueriesActive.inc();
    }
    return originalThen(
      (res: any) => {
        onSettle();
        return onFulfilled ? onFulfilled(res) : res;
      },
      (err: any) => {
        onSettle(err);
        if (onRejected) return onRejected(err);
        throw err;
      }
    );
  };
  return q;
} as any;

/**
 * Transaction instrumentation and deadlock retry.
 *
 * The retry used to sit INSIDE the begin() callback, re-running the caller's
 * function on the same `sql` handle. That cannot work, and was verified against
 * a real PostgreSQL 16 not to: once any statement errors inside a transaction,
 * the transaction enters an aborted state and every subsequent statement fails
 * with 25P02 "current transaction is aborted, commands ignored until end of
 * transaction block". The retry therefore consumed all three attempts, added
 * latency, and surfaced a more confusing error than the original — during
 * exactly the contention incidents it existed to smooth over.
 *
 * A retry must restart the whole transaction, so it runs here, around
 * originalBegin. Re-running the callback is safe precisely because a
 * serialization failure or deadlock means PostgreSQL rolled the transaction back
 * entirely: there is nothing partial to undo.
 */
const originalBegin = client.begin.bind(client);

const RETRYABLE_TX_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

const MAX_TX_ATTEMPTS = 3;

client.begin = function (options: any, cb: any) {
  const callback = typeof options === 'function' ? options : cb;
  const opts = typeof options === 'function' ? {} : options;

  const runOnce = () =>
    typeof options === 'function' ? originalBegin(callback) : originalBegin(opts, callback);

  return (async () => {
    const start = Date.now();
    dbTransactionsActive.inc();
    try {
      let lastError: any;
      for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt++) {
        try {
          const res = await runOnce();
          const duration = Date.now() - start;
          dbTransactionDuration.observe(duration / 1000);
          if (duration > 1000) {
            logger.warn({ durationMs: duration, attempts: attempt }, '[DB] Long running database transaction committed (>1s)');
          }
          return res;
        } catch (err: any) {
          lastError = err;
          const code = err?.code || err?.statusCode || '';
          if (!RETRYABLE_TX_CODES.has(code) || attempt === MAX_TX_ATTEMPTS) break;
          // Jittered: two transactions that deadlocked against each other must
          // not retry in step and deadlock again.
          const delay = Math.min(100 * 2 ** attempt, 1000) * (0.5 + Math.random() * 0.5);
          logger.warn(
            { code, attempt, nextDelayMs: Math.round(delay) },
            '[DB] Serialization or deadlock failure. Restarting the transaction...'
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      const duration = Date.now() - start;
      dbTransactionDuration.observe(duration / 1000);
      logger.warn({ durationMs: duration, err: lastError?.message }, '[DB] Transaction rolled back/failed');
      throw lastError;
    } finally {
      dbTransactionsActive.dec();
    }
  })();
} as any;

export const db = drizzle(client, { schema });

export async function endDbConnection() {
  await client.end({ timeout: 5 });
  console.log('[DB] Database connection closed.');
}
