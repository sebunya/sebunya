/**
 * SyncGscPerformanceUseCase — incremental daily sync of Google Search Console
 * search-analytics rows (date/page/query) into the gsc_performance warehouse.
 *
 * Honest-integration contract (CLAUDE.md): when GSC credentials are absent the
 * use case returns { status: 'READY_FOR_CREDENTIALS' } without erroring and
 * without touching the warehouse. The moment GSC_SERVICE_ACCOUNT_JSON and
 * GSC_SITE_URL are set, the same code path syncs for real.
 *
 * Behaviour:
 *  - First run backfills up to 16 months, in date-chunked requests (≤31 days).
 *  - Subsequent runs resume from sync_state.lastSyncedDate + 1 day.
 *  - Data is synced only up to (today − 2 days) — GSC data is not final before
 *    that.
 *  - Each chunk pages searchanalytics.query with rowLimit 25 000 via startRow.
 *  - 429/5xx responses retry with exponential backoff, max 3 retries.
 *  - Rows upsert on (date, page, query); sync_state tracks
 *    { lastSyncedDate, lastRowCount }; last_success_at / last_failure_at /
 *    last_error are recorded on the GSC seo_integrations row.
 */

export interface GscRowsPage {
  rows: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
}

export interface GscQueryPort {
  query(input: { startDate: string; endDate: string; startRow: number; rowLimit: number }): Promise<GscRowsPage>;
}

export interface GscPerformanceUpsertRow {
  date: string;
  page: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

export interface GscSyncStore {
  getIntegration(provider: string): Promise<{ sync_state?: unknown } | null>;
  upsertIntegrationStatus(provider: string, patch: {
    status?: string;
    lastSuccessAt?: Date | null;
    lastFailureAt?: Date | null;
    lastError?: string | null;
    syncState?: Record<string, unknown> | null;
  }): Promise<unknown>;
  upsertGscPerformance(rows: GscPerformanceUpsertRow[]): Promise<number>;
}

export type GscSyncResult =
  | { status: 'READY_FOR_CREDENTIALS' }
  | { status: 'NO_NEW_DATA'; lastSyncedDate: string }
  | { status: 'SYNCED'; startDate: string; endDate: string; rowsUpserted: number }
  | { status: 'FAILED'; error: string };

const ROW_LIMIT = 25_000;
const CHUNK_DAYS = 31;
const BACKFILL_MONTHS = 16;
const MAX_RETRIES = 3;

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

export class SyncGscPerformanceUseCase {
  constructor(
    private readonly deps: {
      /** null when credentials are absent — the honest no-op path. */
      client: GscQueryPort | null;
      store: GscSyncStore;
      now?: () => Date;
      /** Injectable sleep so tests never wait; default real backoff. */
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  private async queryWithRetry(input: { startDate: string; endDate: string; startRow: number; rowLimit: number }): Promise<GscRowsPage> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let attempt = 0;
    for (;;) {
      try {
        return await this.deps.client!.query(input);
      } catch (err: any) {
        const status = typeof err?.status === 'number' ? err.status : 0;
        const retryable = status === 429 || (status >= 500 && status < 600);
        if (!retryable || attempt >= MAX_RETRIES) throw err;
        attempt += 1;
        await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s, 4s
      }
    }
  }

  async execute(): Promise<GscSyncResult> {
    if (!this.deps.client) return { status: 'READY_FOR_CREDENTIALS' };
    const { store } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();

    // GSC data is only final ~2 days behind.
    const endDate = iso(new Date(now.getTime() - 2 * 24 * 3600 * 1000));

    let startDate: string;
    const integration = await store.getIntegration('GSC');
    const syncState = (integration?.sync_state ?? null) as { lastSyncedDate?: string } | null;
    if (syncState?.lastSyncedDate) {
      startDate = addDays(syncState.lastSyncedDate, 1);
    } else {
      const backfillStart = new Date(now);
      backfillStart.setUTCMonth(backfillStart.getUTCMonth() - BACKFILL_MONTHS);
      startDate = iso(backfillStart);
    }
    if (startDate > endDate) {
      return { status: 'NO_NEW_DATA', lastSyncedDate: syncState?.lastSyncedDate ?? endDate };
    }

    let totalUpserted = 0;
    try {
      // Date-chunked requests so a 16-month backfill never asks for everything at once.
      let chunkStart = startDate;
      while (chunkStart <= endDate) {
        const chunkEndCandidate = addDays(chunkStart, CHUNK_DAYS - 1);
        const chunkEnd = chunkEndCandidate < endDate ? chunkEndCandidate : endDate;

        let startRow = 0;
        for (;;) {
          const page = await this.queryWithRetry({ startDate: chunkStart, endDate: chunkEnd, startRow, rowLimit: ROW_LIMIT });
          const rows: GscPerformanceUpsertRow[] = page.rows
            .filter((r) => Array.isArray(r.keys) && r.keys.length >= 3)
            .map((r) => ({
              date: r.keys[0],
              page: r.keys[1].slice(0, 512),
              query: r.keys[2].slice(0, 300),
              clicks: Math.round(r.clicks ?? 0),
              impressions: Math.round(r.impressions ?? 0),
              ctr: typeof r.ctr === 'number' ? r.ctr : null,
              position: typeof r.position === 'number' ? r.position : null,
            }));
          if (rows.length > 0) totalUpserted += await store.upsertGscPerformance(rows);
          if (page.rows.length < ROW_LIMIT) break;
          startRow += ROW_LIMIT;
        }

        // Persist progress per chunk so an interrupted backfill resumes.
        await store.upsertIntegrationStatus('GSC', {
          syncState: { lastSyncedDate: chunkEnd, lastRowCount: totalUpserted },
        });
        chunkStart = addDays(chunkEnd, 1);
      }

      await store.upsertIntegrationStatus('GSC', {
        status: 'CONNECTED',
        lastSuccessAt: now,
        lastError: null,
        syncState: { lastSyncedDate: endDate, lastRowCount: totalUpserted },
      });
      return { status: 'SYNCED', startDate, endDate, rowsUpserted: totalUpserted };
    } catch (err: any) {
      const message = String(err?.message ?? err).slice(0, 500);
      await store.upsertIntegrationStatus('GSC', {
        status: 'ERROR',
        lastFailureAt: now,
        lastError: message,
      });
      return { status: 'FAILED', error: message };
    }
  }
}
