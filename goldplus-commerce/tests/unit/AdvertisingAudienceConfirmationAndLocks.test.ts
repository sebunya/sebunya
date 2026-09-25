import { describe, it, expect, vi } from 'vitest';
import type {
  AudienceGateway, AudienceListRepository, AudienceRunRecord, JobClaimPort, PendingAudienceRun, PlatformCredentials, SpendImportRecord,
} from '../../apps/api/src/application/ports/Advertising';
import { AudienceSyncUseCases, type AudienceSyncExtras } from '../../apps/api/src/application/use-cases/advertising/AudienceSyncUseCases';
import { DAILY_MAX_ATTEMPTS, dailyJobKey, runDailyAdvertisingJobs } from '../../apps/api/src/application/use-cases/advertising/AdvertisingDailyJobs';
import {
  CONFIRMATION_GIVE_UP_MS, combineOutcomes, confirmationLabel, nextConfirmationStep, type Confirmation, type RemoteRequestOutcome,
} from '../../apps/api/src/domain/advertising/AudienceConfirmation';
import {
  HttpAudienceGateway, HttpSpendGateway, dataManagerOutcome, offlineRequest, withoutAccessToken,
} from '../../apps/api/src/infrastructure/advertising/AdvertisingGateways';
import { audienceRunMessage, audienceRunStatus } from '../../apps/web/src/lib/adminAdvertising';

/**
 * Second fixer pass on advertising (docs/advertising/README.md):
 *  - Google audience uploads are SUBMITTED until Google confirms them
 *    (requestStatus:retrieve); the stale-member sweep only follows a confirmed
 *    SUCCESS of every ingest; FAILED / PARTIAL_SUCCESS never report a success;
 *  - one SYNC per platform at a time (no orphaned list);
 *  - a failed daily job is retried the same day, at most 3 times;
 *  - Meta tokens never travel in a URL.
 */

const NOW = new Date('2026-09-25T03:00:00Z');
const creds = (over: Partial<PlatformCredentials> = {}): PlatformCredentials => ({ config: {}, secret: 'CAP_SECRET_TOKEN_123', destinationConfig: {}, destinationSecret: 'DEST_SECRET_TOKEN_456', testMode: false, ...over });
const liveCap = (platform: string, config: Record<string, string> = {}) => ({ platform, row: { config } } as any);
const order = (i: number) => ({ orderId: `o${i}`, userId: null, email: `p${i}@x.co`, phone: `07000000${String(i).padStart(2, '0')}`, fpClientId: null, totalUgx: 100_000 * i, purchasedAt: new Date('2026-09-20T00:00:00Z'), status: 'delivered', paymentStatus: 'paid' });
const outcome = (requestId: string, ...statuses: RemoteRequestOutcome['statuses']): RemoteRequestOutcome => ({ requestId, statuses, errors: [] });

/** An in-memory run log that behaves like DrizzleAudienceRepository (confirmation columns only are updated). */
function memoryLists(remote: Record<string, string> = {}) {
  const runs: Array<AudienceRunRecord & { id: string }> = [];
  const slots = new Map(Object.entries(remote));
  let n = 0;
  const lists: AudienceListRepository = {
    remoteId: async (p, s) => slots.get(`${p}:${s}`) ?? null,
    saveRemoteId: async (p, s, id) => void slots.set(`${p}:${s}`, id),
    forgetRemoteId: async (p, s) => void slots.delete(`${p}:${s}`),
    storedSegments: async (p) => [...slots.keys()].filter((k) => k.startsWith(`${p}:`)).map((k) => k.slice(p.length + 1)),
    recordRun: async (r) => void runs.push({ ...r, id: `run-${++n}` }),
    recentRuns: async () => runs,
    pendingConfirmations: async (): Promise<PendingAudienceRun[]> => runs
      .filter((r) => (r.confirmation === 'WAITING' || r.confirmation === 'SWEEPING') && r.remoteRequests)
      .map((r) => ({ id: r.id, platform: r.platform, segment: r.segment, remoteListId: r.remoteListId, startedAt: r.startedAt, remoteRequests: r.remoteRequests!, confirmation: r.confirmation as 'WAITING' | 'SWEEPING' })),
    updateConfirmation: async (id, patch) => {
      const r = runs.find((x) => x.id === id)!;
      r.confirmation = patch.confirmation;
      r.confirmationDetail = patch.detail;
      if (patch.sweepRequestId) r.remoteRequests = { ...r.remoteRequests!, sweep: patch.sweepRequestId };
    },
  };
  return { lists, runs, slots };
}

function googleHarness(statusReplies: RemoteRequestOutcome[][], opts: { extras?: AudienceSyncExtras; now?: () => Date } = {}) {
  const mem = memoryLists({ 'google_ads:past_buyers': 'accountTypes/GOOGLE_ADS/accounts/1/userLists/55' });
  const calls: string[] = [];
  const gateway: AudienceGateway = {
    createList: vi.fn(async () => { calls.push('create'); return { remoteId: 'x', uploaded: null }; }),
    replaceMembers: vi.fn(async (_p, _id, members) => { calls.push(`ingest:${members.length}`); return { uploaded: members.length, requestIds: ['req-1', 'req-2'] }; }),
    clearList: vi.fn(async () => { calls.push('clear'); return { forget: false, requestIds: ['req-clear'] }; }),
    requestStatus: vi.fn(async (_p, ids) => { calls.push(`status:${ids.join('+')}`); return statusReplies.shift() ?? []; }),
    sweepStale: vi.fn(async (_p, _id, asOf) => { calls.push(`sweep:${asOf.toISOString()}`); return { requestId: 'req-sweep' }; }),
  };
  const recordCapabilityRun = vi.fn(async () => undefined);
  const uc = new AudienceSyncUseCases(
    { buyerOrders: async () => [order(1), order(2)], refusedIdentities: async () => ({ userIds: new Set<string>(), fpClientIds: new Set<string>() }) },
    mem.lists, gateway, async (p) => liveCap(p, { segments: 'past_buyers' }), async () => creds(), opts.now ?? (() => NOW),
    { recordCapabilityRun, ...opts.extras },
  );
  return { uc, calls, gateway, recordCapabilityRun, ...mem };
}

describe('confirmation state machine (domain)', () => {
  it('combines per-destination statuses: any processing waits; all success; all failed; otherwise partial', () => {
    expect(combineOutcomes([outcome('a', 'SUCCESS'), outcome('b', 'SUCCESS', 'SUCCESS')]).status).toBe('SUCCESS');
    expect(combineOutcomes([outcome('a', 'SUCCESS'), outcome('b', 'PROCESSING')]).status).toBe('PROCESSING');
    expect(combineOutcomes([outcome('a', 'REQUEST_STATUS_UNKNOWN')]).status).toBe('PROCESSING');
    expect(combineOutcomes([outcome('a')]).status).toBe('PROCESSING'); // no status yet is not a success
    expect(combineOutcomes([]).status).toBe('PROCESSING');
    expect(combineOutcomes([outcome('a', 'FAILED'), outcome('b', 'FAILED')]).status).toBe('FAILED');
    expect(combineOutcomes([outcome('a', 'SUCCESS'), outcome('b', 'FAILED')]).status).toBe('PARTIAL_SUCCESS');
    expect(combineOutcomes([outcome('a', 'PARTIAL_SUCCESS')]).status).toBe('PARTIAL_SUCCESS');
  });
  it('SUCCESS of every ingest → sweep; FAILED / PARTIAL → finish without a sweep; sweep SUCCESS → confirmed', () => {
    const ok = combineOutcomes([outcome('a', 'SUCCESS')]);
    expect(nextConfirmationStep({ confirmation: 'WAITING', kind: 'REPLACE', outcome: ok, ageMs: 0 })).toEqual({ action: 'SWEEP' });
    expect(nextConfirmationStep({ confirmation: 'WAITING', kind: 'CLEAR', outcome: ok, ageMs: 0 })).toMatchObject({ action: 'FINISH', confirmation: 'CONFIRMED' });
    expect(nextConfirmationStep({ confirmation: 'SWEEPING', kind: 'REPLACE', outcome: ok, ageMs: 0 })).toMatchObject({ action: 'FINISH', confirmation: 'CONFIRMED' });
    const failed = nextConfirmationStep({ confirmation: 'WAITING', kind: 'REPLACE', outcome: { status: 'FAILED', errors: ['INVALID_TERMS: 2 records'] }, ageMs: 0 });
    expect(failed).toMatchObject({ action: 'FINISH', confirmation: 'FAILED' });
    expect((failed as any).detail).toContain('INVALID_TERMS: 2 records');
    expect(nextConfirmationStep({ confirmation: 'WAITING', kind: 'REPLACE', outcome: { status: 'PARTIAL_SUCCESS', errors: [] }, ageMs: 0 })).toMatchObject({ action: 'FINISH', confirmation: 'PARTIAL' });
    expect(nextConfirmationStep({ confirmation: 'SWEEPING', kind: 'REPLACE', outcome: { status: 'FAILED', errors: [] }, ageMs: 0 })).toMatchObject({ action: 'FINISH', confirmation: 'FAILED' });
  });
  it('still processing: waits, then gives up as UNCONFIRMED (never a success)', () => {
    const p = combineOutcomes([outcome('a', 'PROCESSING')]);
    expect(nextConfirmationStep({ confirmation: 'WAITING', kind: 'REPLACE', outcome: p, ageMs: 60_000 })).toEqual({ action: 'WAIT' });
    expect(nextConfirmationStep({ confirmation: 'WAITING', kind: 'REPLACE', outcome: p, ageMs: CONFIRMATION_GIVE_UP_MS + 1 })).toMatchObject({ action: 'FINISH', confirmation: 'UNCONFIRMED' });
  });
  it('labels: waiting runs say so in admin', () => {
    expect(confirmationLabel('WAITING')).toBe('Sent, waiting for Google');
    expect(confirmationLabel('SWEEPING')).toBe('Sent, waiting for Google');
    expect(confirmationLabel(null)).toBeNull();
    for (const c of ['WAITING', 'SWEEPING', 'CONFIRMED', 'PARTIAL', 'FAILED', 'UNCONFIRMED'] as Confirmation[]) {
      expect(audienceRunStatus({ status: 'SUBMITTED', confirmation: c })).toBe(confirmationLabel(c));
    }
    expect(audienceRunStatus({ status: 'SYNCED', confirmation: null })).toBe('SYNCED');
    expect(audienceRunMessage({ message: 'Sent.', confirmationDetail: 'Google rejected the upload.' })).toBe('Sent. Google rejected the upload.');
  });
});

describe('Google audience runs: SUBMITTED until Google confirms', () => {
  it('a sync is logged SUBMITTED with its request ids, never SYNCED, and sends no sweep', async () => {
    const h = googleHarness([]);
    const out = await h.uc.run('google_ads', 'SYNC', 'ADMIN', null);
    expect(out[0]).toMatchObject({ status: 'SUBMITTED', confirmation: 'WAITING', remoteRequests: { kind: 'REPLACE', ingest: ['req-1', 'req-2'], sweep: null } });
    expect(out.some((r) => r.status === 'SYNCED')).toBe(false);
    expect(h.calls).toEqual(['ingest:2']);
    expect(audienceRunStatus(out[0])).toBe('Sent, waiting for Google');
  });
  it('SUCCESS: every ingest confirmed → sweep with removeAsOfTime = the run start → sweep confirmed → CONFIRMED', async () => {
    const h = googleHarness([[outcome('req-1', 'SUCCESS'), outcome('req-2', 'SUCCESS')], [outcome('req-sweep', 'SUCCESS')]]);
    await h.uc.run('google_ads', 'SYNC', 'SCHEDULE', null);
    const first = await h.uc.confirmPending();
    expect(first).toMatchObject({ checked: 1, waiting: 1 });
    expect(h.calls).toEqual(['ingest:2', 'status:req-1+req-2', `sweep:${NOW.toISOString()}`]);
    expect(h.runs[0].confirmation).toBe('SWEEPING');
    const second = await h.uc.confirmPending();
    expect(second).toMatchObject({ checked: 1, confirmed: 1 });
    expect(h.calls.at(-1)).toBe('status:req-sweep');
    expect(h.runs[0].confirmation).toBe('CONFIRMED');
    expect(h.runs[0].status).toBe('SUBMITTED'); // the recorded run is never rewritten
    expect(await h.uc.confirmPending()).toMatchObject({ checked: 0 });
  });
  it('FAILED: recorded with Google\'s errors, no sweep, and the capability shows the failure', async () => {
    const h = googleHarness([[{ requestId: 'req-1', statuses: ['FAILED'], errors: ['PROCESSING_ERROR_REASON_INVALID_USER_LIST: 2 records'] }, outcome('req-2', 'FAILED')]]);
    await h.uc.run('google_ads', 'SYNC', 'SCHEDULE', null);
    expect(await h.uc.confirmPending()).toMatchObject({ failed: 1 });
    expect(h.calls.some((c) => c.startsWith('sweep'))).toBe(false);
    expect(h.runs[0].confirmation).toBe('FAILED');
    expect(h.runs[0].confirmationDetail).toContain('INVALID_USER_LIST');
    expect(h.recordCapabilityRun).toHaveBeenLastCalledWith('google_ads', 'FAILED', expect.stringContaining('rejected'));
    expect(audienceRunStatus(h.runs[0])).toBe('Rejected by Google');
  });
  it('PARTIAL_SUCCESS: recorded as partial and the sweep is NOT sent', async () => {
    const h = googleHarness([[outcome('req-1', 'SUCCESS'), outcome('req-2', 'PARTIAL_SUCCESS')]]);
    await h.uc.run('google_ads', 'SYNC', 'SCHEDULE', null);
    expect(await h.uc.confirmPending()).toMatchObject({ failed: 1 });
    expect(h.calls.some((c) => c.startsWith('sweep'))).toBe(false);
    expect(h.runs[0].confirmation).toBe('PARTIAL');
  });
  it('still processing: nothing concluded; a failed status read is retried later, not concluded', async () => {
    const h = googleHarness([[outcome('req-1', 'PROCESSING'), outcome('req-2', 'SUCCESS')]]);
    await h.uc.run('google_ads', 'SYNC', 'SCHEDULE', null);
    expect(await h.uc.confirmPending()).toMatchObject({ waiting: 1 });
    expect(h.runs[0].confirmation).toBe('WAITING');
    (h.gateway.requestStatus as any).mockRejectedValueOnce(new Error('HTTP 503'));
    expect(await h.uc.confirmPending()).toMatchObject({ waiting: 1 });
    expect(h.runs[0].confirmation).toBe('WAITING');
  });
  it('emptying a Google list is confirmed the same way (no sweep)', async () => {
    const h = googleHarness([[outcome('req-clear', 'SUCCESS')]]);
    // Nobody is eligible any more: the stored list is emptied.
    (h.uc as any).source = { buyerOrders: async () => [], refusedIdentities: async () => ({ userIds: new Set(), fpClientIds: new Set() }) };
    const out = await h.uc.run('google_ads', 'SYNC', 'SCHEDULE', null);
    expect(out[0]).toMatchObject({ status: 'SUBMITTED', remoteRequests: { kind: 'CLEAR', ingest: ['req-clear'] } });
    await h.uc.confirmPending();
    expect(h.runs[0].confirmation).toBe('CONFIRMED');
    expect(h.calls.some((c) => c.startsWith('sweep'))).toBe(false);
  });
});

describe('Data Manager request status and sweep requests', () => {
  // Each test its own refresh token: the access token is cached per client + refresh token.
  const google = (refresh = 'DM_REFRESH_TOKEN_confirm') => creds({
    destinationConfig: { customerId: '1234567890', conversionActionId: '777', apiVersion: 'v25', loginCustomerId: '' },
    destinationSecret: JSON.stringify({ developerToken: 'DEVTOKEN_confirm', clientId: 'c3.apps.googleusercontent.com', clientSecret: 'CSECRET_confirm', refreshToken: 'ADS_ONLY_confirm' }),
    secret: refresh, config: { customerMatchTerms: 'accepted' },
  });
  function fetchWith(replies: unknown[]) {
    const calls: Array<{ url: string; init: any }> = [];
    const f = vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify(replies.shift() ?? {}), { status: 200 }); });
    return { f: f as unknown as typeof fetch, calls };
  }
  it('requestStatus:retrieve is a GET per request id; statuses and error counts are read per destination', async () => {
    const { f, calls } = fetchWith([
      { access_token: 'ACCESS_confirm', expires_in: 3600 },
      { requestStatusPerDestination: [{ requestStatus: 'SUCCESS', audienceMembersIngestionStatus: { userDataIngestionStatus: { recordCount: '2' } } }] },
      { requestStatusPerDestination: [{ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ recordCount: '3', reason: 'PROCESSING_ERROR_REASON_INVALID_FORMAT' }] } }] },
    ]);
    const r = await new HttpAudienceGateway(f).requestStatus('google_ads', ['id/1', 'id2'], google());
    expect(calls[1].url).toBe('https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=id%2F1');
    expect(calls[1].init.method).toBe('GET');
    expect(calls[1].init.headers.Authorization).toBe('Bearer ACCESS_confirm');
    expect(r).toEqual([
      { requestId: 'id/1', statuses: ['SUCCESS'], errors: [] },
      { requestId: 'id2', statuses: ['FAILED'], errors: ['PROCESSING_ERROR_REASON_INVALID_FORMAT: 3 records'] },
    ]);
    expect(dataManagerOutcome('z', { requestStatusPerDestination: [{ requestStatus: 'SOMETHING_NEW' }] }).statuses).toEqual(['REQUEST_STATUS_UNKNOWN']);
  });
  it('the sweep is removeAll with removeAsOfTime = exactly the run start, and returns its request id', async () => {
    const { f, calls } = fetchWith([{ access_token: 'ACCESS_sweep', expires_in: 3600 }, { requestId: 'sweep-1' }]);
    const r = await new HttpAudienceGateway(f).sweepStale('google_ads', 'accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/55', NOW, google('DM_REFRESH_TOKEN_sweep'));
    expect(r).toEqual({ requestId: 'sweep-1' });
    expect(calls[1].url).toBe('https://datamanager.googleapis.com/v1/audienceMembers:removeAll');
    expect(JSON.parse(calls[1].init.body)).toEqual({
      destinations: [{ operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' }, productDestinationId: '55' }],
      removeAsOfTime: NOW.toISOString(),
    });
  });
  it('an ingest reply without a request id is an error (its outcome could never be confirmed)', async () => {
    const { f } = fetchWith([{ access_token: 'ACCESS_noid', expires_in: 3600 }, {}]);
    await expect(new HttpAudienceGateway(f).replaceMembers('google_ads', '55', [{ email: 'e'.repeat(64), phone: null }], google('DM_REFRESH_TOKEN_noid'))).rejects.toThrow(/request id/);
  });
});

describe('one SYNC per platform at a time', () => {
  function memoryLock() {
    const held = new Map<string, string>();
    let n = 0;
    return {
      held,
      lock: {
        acquireLock: vi.fn(async (key: string) => { if (held.has(key)) return null; const t = `t${++n}`; held.set(key, t); return t; }),
        releaseLock: vi.fn(async (key: string, token: string) => { if (held.get(key) === token) held.delete(key); }),
      },
    };
  }
  it('two concurrent runs produce exactly one createList; the other is BUSY and calls nothing', async () => {
    const mem = memoryLists();
    const { lock, held } = memoryLock();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const created: string[] = [];
    const gateway: AudienceGateway = {
      createList: vi.fn(async () => { created.push('create'); await gate; return { remoteId: `list-${created.length}`, uploaded: null }; }),
      replaceMembers: vi.fn(async (_p, _id, m) => ({ uploaded: m.length })),
      clearList: vi.fn(async () => ({ forget: true })),
    };
    const uc = new AudienceSyncUseCases(
      { buyerOrders: async () => [order(1)], refusedIdentities: async () => ({ userIds: new Set<string>(), fpClientIds: new Set<string>() }) },
      mem.lists, gateway, async (p) => liveCap(p, { segments: 'past_buyers' }), async () => creds(), () => NOW, { lock },
    );
    const a = uc.run('meta', 'SYNC', 'SCHEDULE', null);
    const b = uc.run('meta', 'SYNC', 'ADMIN', null);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(gateway.createList).toHaveBeenCalledTimes(1);
    expect([...ra, ...rb].filter((r) => r.status === 'BUSY')).toHaveLength(1);
    expect(mem.slots.get('meta:past_buyers')).toBe('list-1');
    expect(held.size).toBe(0); // released after the run
    // A dry run never needs the lock.
    lock.acquireLock.mockClear();
    await uc.run('meta', 'DRY_RUN', 'ADMIN', null);
    expect(lock.acquireLock).not.toHaveBeenCalled();
  });
  it('a lock that cannot be read counts as held: BUSY, no platform call', async () => {
    const mem = memoryLists();
    const gateway = { createList: vi.fn(), replaceMembers: vi.fn(), clearList: vi.fn() } as unknown as AudienceGateway;
    const uc = new AudienceSyncUseCases(
      { buyerOrders: async () => [order(1)], refusedIdentities: async () => ({ userIds: new Set<string>(), fpClientIds: new Set<string>() }) },
      mem.lists, gateway, async (p) => liveCap(p), async () => creds(), () => NOW,
      { lock: { acquireLock: async () => { throw new Error('db down'); }, releaseLock: async () => undefined } },
    );
    const out = await uc.run('meta', 'SYNC', 'ADMIN', null);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('BUSY');
    expect(gateway.createList).not.toHaveBeenCalled();
  });
});

describe('daily jobs: a failure is retried the same day, at most 3 times', () => {
  /** Emulates DrizzleJobClaims.claimAttempt/settleAttempt semantics in memory. */
  function memoryJobs() {
    const rows = new Map<string, { attempts: number; done: boolean; leasedUntil: number; holder: string }>();
    let clock = 0, n = 0;
    const jobs: Pick<JobClaimPort, 'claimAttempt' | 'settleAttempt'> = {
      claimAttempt: async (key, o) => {
        const r = rows.get(key);
        const token = `h${++n}`;
        if (!r) { rows.set(key, { attempts: 1, done: false, leasedUntil: clock + o.leaseMs, holder: token }); return token; }
        if (r.done || r.attempts >= o.maxAttempts || r.leasedUntil > clock) return null;
        Object.assign(r, { attempts: r.attempts + 1, leasedUntil: clock + o.leaseMs, holder: token });
        return token;
      },
      settleAttempt: async (key, token, ok, retryAfterMs) => {
        const r = rows.get(key)!;
        if (r.holder !== token) return;
        if (ok) { r.done = true; r.leasedUntil = clock; } else r.leasedUntil = clock + retryAfterMs;
      },
    };
    return { jobs, rows, advance: (ms: number) => { clock += ms; } };
  }
  const spendRec = (status: string): SpendImportRecord => ({ platform: 'meta', trigger: 'SCHEDULE', status, dateFrom: null, dateTo: null, rowsWritten: 0, message: null, actorId: null, startedAt: NOW });

  it('retries a failed audience sync on a later tick, stops once it succeeds, and never runs a done job again', async () => {
    const m = memoryJobs();
    const results: AudienceRunRecord[][] = [
      [{ status: 'CONSENT_UNREADABLE' } as AudienceRunRecord],
      [{ status: 'SUBMITTED', segment: 'past_buyers' } as AudienceRunRecord],
    ];
    const run = vi.fn(async () => results.shift() ?? []);
    const deps = { jobs: m.jobs, audiences: { live: async (p: string) => p === 'google_ads', run }, spend: { live: async () => false, run: vi.fn() } };
    expect((await runDailyAdvertisingJobs('2026-09-25', deps))[0]).toMatchObject({ platform: 'google_ads', ok: false });
    // The next tick, 5 minutes later, waits (retry spacing).
    m.advance(5 * 60_000);
    expect(await runDailyAdvertisingJobs('2026-09-25', deps)).toEqual([]);
    m.advance(20 * 60_000);
    expect((await runDailyAdvertisingJobs('2026-09-25', deps))[0]).toMatchObject({ ok: true });
    m.advance(60 * 60_000);
    expect(await runDailyAdvertisingJobs('2026-09-25', deps)).toEqual([]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(m.rows.get(dailyJobKey('2026-09-25', 'audiences', 'google_ads'))).toMatchObject({ attempts: 2, done: true });
  });
  it(`gives up after ${DAILY_MAX_ATTEMPTS} failed attempts; a platform error thrown is a failed attempt`, async () => {
    const m = memoryJobs();
    const run = vi.fn(async () => { throw new Error('HTTP 500'); });
    const deps = { jobs: m.jobs, audiences: { live: async () => false, run: vi.fn() }, spend: { live: async (p: string) => p === 'meta', run } };
    for (let i = 0; i < 6; i++) { await runDailyAdvertisingJobs('2026-09-25', deps); m.advance(30 * 60_000); }
    expect(run).toHaveBeenCalledTimes(DAILY_MAX_ATTEMPTS);
  });
  it('each platform is its own job: one platform failing does not rerun the other', async () => {
    const m = memoryJobs();
    const spend = vi.fn(async (p: string) => spendRec(p === 'meta' ? 'FAILED' : 'IMPORTED'));
    const deps = { jobs: m.jobs, audiences: { live: async () => false, run: vi.fn() }, spend: { live: async () => true, run: spend } };
    await runDailyAdvertisingJobs('2026-09-25', deps);
    m.advance(30 * 60_000);
    await runDailyAdvertisingJobs('2026-09-25', deps);
    expect(spend.mock.calls.map((c) => c[0])).toEqual(['google_ads', 'meta', 'meta']);
  });
  it('an audience run with a FAILED or BUSY list must be retried; SUBMITTED or EMPTY does not', () => {
    expect(AudienceSyncUseCases.runNeedsRetry([{ status: 'SUBMITTED' }, { status: 'FAILED' }] as AudienceRunRecord[])).toBe(true);
    expect(AudienceSyncUseCases.runNeedsRetry([{ status: 'BUSY' }] as AudienceRunRecord[])).toBe(true);
    expect(AudienceSyncUseCases.runNeedsRetry([{ status: 'SUBMITTED' }, { status: 'EMPTY' }, { status: 'SYNCED' }] as AudienceRunRecord[])).toBe(false);
  });
});

describe('admin preview: a failed segment read is a reason, not an empty page', () => {
  it('each selected owner segment gets a blocker row saying nothing would be uploaded', async () => {
    const mem = memoryLists();
    const uc = new AudienceSyncUseCases(
      { buyerOrders: async () => [order(1)], refusedIdentities: async () => ({ userIds: new Set<string>(), fpClientIds: new Set<string>() }) },
      mem.lists, {} as AudienceGateway, async (p) => liveCap(p, { customSegments: 'vip,lapsed' }), async () => creds(), () => NOW,
      { customSegments: { source: { advertisingAudience: vi.fn() }, list: async () => { throw new Error('db down'); } } },
    );
    const rows = (await uc.preview()).filter((r) => r.platform === 'meta' && r.segment.startsWith('seg:'));
    expect(rows.map((r) => r.segment)).toEqual(['seg:vip', 'seg:lapsed']);
    for (const r of rows) expect(r.blocker).toBe('Segments could not be read; nothing would be uploaded.');
  });
});

describe('Meta tokens never travel in a URL', () => {
  it('Insights: the token is in the Authorization header; a paging next URL has its access_token stripped', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const replies = [
      { data: [{ campaign_id: '1', spend: '10.00', account_currency: 'USD', date_start: '2026-09-20' }], paging: { next: 'https://graph.facebook.com/v23.0/act_1010/insights?after=abc&access_token=EAAB_LEAKED_IN_NEXT' } },
      { data: [] },
    ];
    const f = vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify(replies.shift() ?? {}), { status: 200 }); }) as unknown as typeof fetch;
    const facts = await new HttpSpendGateway(f).fetchDaily('meta', '2026-09-20', '2026-09-21', creds({ config: { adAccountId: '1010' }, secret: 'EAAB_META_SPEND_TOKEN' }));
    expect(facts).toHaveLength(1);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.url).not.toContain('access_token');
      expect(c.url).not.toContain('EAAB_');
      expect(c.init.headers.Authorization).toBe('Bearer EAAB_META_SPEND_TOKEN');
    }
    expect(calls[1].url).toBe('https://graph.facebook.com/v23.0/act_1010/insights?after=abc');
    expect(withoutAccessToken('https://graph.facebook.com/x?access_token=a&b=1')).toBe('https://graph.facebook.com/x?b=1');
  });
  it('custom audiences and offline conversions: header, not URL or body', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const f = vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: '2385' }), { status: 200 }); }) as unknown as typeof fetch;
    const g = new HttpAudienceGateway(f);
    const c = creds({ config: { adAccountId: '1010' }, secret: 'EAAB_AUDIENCE_TOKEN' });
    await g.createList('meta', { name: 'n', description: 'd', membershipDays: 540 }, [], c);
    await g.replaceMembers('meta', '2385', [{ email: 'e'.repeat(64), phone: null }], c);
    for (const x of calls) {
      expect(x.url).not.toContain('EAAB_');
      expect(String(x.init.body)).not.toContain('EAAB_');
      expect(x.init.headers.Authorization).toBe('Bearer EAAB_AUDIENCE_TOKEN');
    }
    const req = offlineRequest({
      row: { id: 'r', platform: 'meta', source: 'ADMIN_SALE', sourceRef: '33333333-3333-4333-8333-333333333333', eventId: 'e', occurredAt: '2026-09-24T10:00:00Z', state: 'PENDING', reason: null, attemptCount: 0, sentAt: null },
      valueUgx: 1, orderId: null, orderNumber: null, channel: 'PHONE', hashes: { emailSha256: null, emailGoogleSha256: null, phoneDigitsSha256: 'd'.repeat(64), phonePlusSha256: null }, clickIds: {}, subjects: { userIds: [], fpClientIds: [] },
    }, creds({ destinationConfig: { datasetId: '1' }, destinationSecret: 'EAAB_DATASET_TOKEN' }))!;
    expect(req.headers.Authorization).toBe('Bearer EAAB_DATASET_TOKEN');
    expect(JSON.stringify(req.body)).not.toContain('EAAB_');
    expect(req.url).not.toContain('access_token');
  });
});
