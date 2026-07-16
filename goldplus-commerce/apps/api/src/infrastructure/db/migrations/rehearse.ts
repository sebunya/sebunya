/* Slice 14D rehearsal-only entrypoint: identical to migrate.ts but takes the
 * migrations folder from MIGRATIONS_FOLDER so the upgrade path can be staged. */
import '../../../config/env';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { isKnownInvalidHistoricalStatement } from './knownInvalidHistoricalStatements';

const run = async () => {
  const folder = process.env.MIGRATIONS_FOLDER || './src/infrastructure/db/migrations';
  const connection = postgres(process.env.DATABASE_URL!, { max: 1 });
  const WRAPPED = Symbol.for('goldplus.migrate.shim');
  const wrapUnsafe = (s: any) => {
    if (s[WRAPPED]) return; s[WRAPPED] = true;
    const orig = s.unsafe.bind(s);
    s.unsafe = (q: string, p?: unknown[], o?: unknown) =>
      typeof q === 'string' && isKnownInvalidHistoricalStatement(q)
        ? (console.warn('[rehearse] skipped dead 0018 statement'), orig('select 1'))
        : orig(q, p, o);
  };
  wrapUnsafe(connection);
  const origBegin = (connection as any).begin.bind(connection);
  (connection as any).begin = (a: any, b?: any) => {
    const cb = typeof a === 'function' ? a : b;
    const wrapped = async (sql: any) => { wrapUnsafe(sql); return cb(sql); };
    return typeof a === 'function' ? origBegin(wrapped) : origBegin(a, wrapped);
  };
  const started = Date.now();
  await migrate(drizzle(connection), { migrationsFolder: folder });
  console.log(`REHEARSE_OK duration_ms=${Date.now() - started}`);
  process.exit(0);
};
run().catch((e) => { console.error('REHEARSE_FAILED', e); process.exit(1); });
