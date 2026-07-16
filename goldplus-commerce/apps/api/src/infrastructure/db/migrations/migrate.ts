import '../../../config/env';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { isKnownInvalidHistoricalStatement } from './knownInvalidHistoricalStatements';

/**
 * Slice 14C — narrowly scoped migration-runner compatibility shim.
 *
 * Historical migration 0018 stays byte-identical to its original committed
 * content, but four of its FK statements are structurally invalid
 * (varchar -> uuid, SQLSTATE 42804) and have therefore never applied in any
 * environment. During bootstrap the runner skips ONLY those four exact
 * statements (exact-match, see knownInvalidHistoricalStatements.ts), records
 * each skip, and lets additive migration 0028 perform the real repair.
 * Upgraded environments never reach 0018 again (the drizzle migrator skips
 * by created_at timestamp), so this shim affects fresh bootstraps only.
 */
const skippedHistoricalStatements: string[] = [];

function installHistoricalStatementShim(connection: ReturnType<typeof postgres>): void {
  const WRAPPED = Symbol.for('goldplus.migrate.shim');
  const wrapUnsafe = (sqlInstance: any) => {
    if (sqlInstance[WRAPPED]) return;
    sqlInstance[WRAPPED] = true;
    const originalUnsafe = sqlInstance.unsafe.bind(sqlInstance);
    sqlInstance.unsafe = (query: string, parameters?: unknown[], options?: unknown) => {
      if (typeof query === 'string' && isKnownInvalidHistoricalStatement(query)) {
        skippedHistoricalStatements.push(query.replace(/\s+/g, ' ').slice(0, 120));
        console.warn('[migrate] Skipping known-invalid historical 0018 statement (repaired by 0028).');
        return originalUnsafe('select 1');
      }
      return originalUnsafe(query, parameters, options);
    };
  };

  // Drizzle executes migration statements inside connection.begin(...) using
  // the transaction-scoped sql instance, so wrap both levels.
  wrapUnsafe(connection);
  const originalBegin = (connection as any).begin.bind(connection);
  (connection as any).begin = (optionsOrCallback: any, maybeCallback?: any) => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    const wrappedCallback = async (scopedSql: any) => {
      wrapUnsafe(scopedSql);
      return callback(scopedSql);
    };
    return typeof optionsOrCallback === 'function'
      ? originalBegin(wrappedCallback)
      : originalBegin(optionsOrCallback, wrappedCallback);
  };
}

const runMigrate = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }

  console.log('Running migrations...');
  const connection = postgres(process.env.DATABASE_URL, { max: 1 });
  installHistoricalStatementShim(connection);
  const db = drizzle(connection);

  await migrate(db, { migrationsFolder: './src/infrastructure/db/migrations' });

  if (skippedHistoricalStatements.length > 0) {
    console.log(
      `Migrations complete! Skipped ${skippedHistoricalStatements.length} known-invalid historical 0018 statement(s); migration 0028 applied the repair.`
    );
  } else {
    console.log('Migrations complete!');
  }
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error('Migration failed!', err);
  process.exit(1);
});
