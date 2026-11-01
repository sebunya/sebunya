import { client } from './client';

/**
 * A Postgres SESSION advisory lock held on ONE reserved connection.
 *
 * A session lock belongs to the backend that took it. Taken and released through
 * the pooled client (`db.execute`, max 20), the unlock usually ran on a different
 * connection: it returned false with a warning (not an error, so `.catch` never
 * fired) and the lock stayed held until that pooled connection idled out — later
 * runs were skipped as "another replica holds it". The reverse also happened: the
 * locking connection idled out mid-run and a second run started alongside.
 *
 * Reserving the connection for the lifetime of the lock fixes both. The rest of a
 * run's work can stay on the pool.
 */
export interface HeldSessionLock {
  release(): Promise<void>;
}

export interface ReservableSql {
  reserve(): Promise<{
    unsafe(query: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
    release(): void;
  }>;
}

export async function tryAcquireSessionLock(
  lockId: number,
  sqlClient: ReservableSql = client as unknown as ReservableSql,
): Promise<HeldSessionLock | null> {
  const conn = await sqlClient.reserve();
  let got = false;
  try {
    const rows = await conn.unsafe('select pg_try_advisory_lock($1) as ok', [lockId]);
    got = rows[0]?.ok === true;
  } catch (err) {
    conn.release();
    throw err;
  }
  if (!got) {
    conn.release();
    return null;
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await conn.unsafe('select pg_advisory_unlock($1)', [lockId]);
      } finally {
        // Back to the pool either way; if the unlock failed the connection is
        // released anyway and the lock ends with its session.
        conn.release();
      }
    },
  };
}
