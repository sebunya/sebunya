import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * First-party fixes (docs/first-party/README.md), with the database stubbed:
 *  - a guest's browser refusal survives a profile fold / link reassignment
 *    (consent anchors follow the person);
 *  - owner segments use THE advertising refusal rule (no 20-browser cap,
 *    identity_links included), read once per 500 members;
 *  - erasure matches quote and battery requests with no row limit, keeps the
 *    consent anchors, removes ad click ids and suppresses waiting offline
 *    conversions;
 *  - privacy idempotency keys are scoped to the customer and the kind.
 */

const { execute, transaction, select, insert } = vi.hoisted(() => ({
  execute: vi.fn(), transaction: vi.fn(), select: vi.fn(), insert: vi.fn(),
}));
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({ db: { execute, transaction, select, insert }, client: {} }));

import { AdvertisingRefusalReader } from '../../apps/api/src/infrastructure/first-party/FirstPartyAdapters';
import { refusedAmong } from '../../apps/api/src/infrastructure/db/repositories/DrizzleAdvertisingOpsRepository';
import { DrizzleIdentityMergeRepository, copyConsentAnchorsSql } from '../../apps/api/src/infrastructure/first-party/DrizzleIdentityRepositories';
import { DrizzlePersonalDataEraser, DrizzlePrivacyRequestRepository, scopedIdempotencyKey } from '../../apps/api/src/infrastructure/first-party/DrizzlePrivacyRepositories';
import { HmacIdentifierHasher } from '../../apps/api/src/infrastructure/first-party/FirstPartyAdapters';
import { SegmentAudienceService, CONSENT_CHUNK } from '../../apps/api/src/application/use-cases/first-party/SegmentAudienceService';

const dialect = new PgDialect();
const render = (q: any) => dialect.sqlToQuery(q);
const text = (q: any) => render(q).sql.replace(/\s+/g, ' ');

beforeEach(() => { execute.mockReset(); transaction.mockReset(); select.mockReset(); insert.mockReset(); });

// ── One refusal rule for owner segments ─────────────────────────────────────

describe('owner segments: the same refusal rule as the built-in lists', () => {
  it('a refusal on the 21st browser counts (no cap), and every browser goes into ONE read', async () => {
    const fps = Array.from({ length: 25 }, (_, i) => `fp.${i + 1}`);
    const among = vi.fn(async (_u: string[], f: string[]) => ({ userIds: new Set<string>(), fpClientIds: new Set(f.filter((x) => x === 'fp.21')) }));
    const reader = new AdvertisingRefusalReader(among);
    expect(await reader.refused({ userId: null, fpClientIds: fps })).toBe(true);
    expect(among).toHaveBeenCalledTimes(1);
    expect(among.mock.calls[0][1]).toHaveLength(25);
  });
  it('refusedMany maps refusals back to each subject, by account or by browser', async () => {
    const U = '11111111-1111-4111-8111-111111111111';
    const among = vi.fn(async () => ({ userIds: new Set([U]), fpClientIds: new Set(['fp.b']) }));
    const r = await new AdvertisingRefusalReader(among).refusedMany([
      { key: 'a', userId: U, fpClientIds: [] }, { key: 'b', userId: null, fpClientIds: ['fp.x', 'fp.b'] }, { key: 'c', userId: null, fpClientIds: ['fp.c'] },
    ]);
    expect([...r].sort()).toEqual(['a', 'b']);
  });
  it('the rule includes a refusal given on a browser LINKED to the account (identity_links)', async () => {
    const U = '22222222-2222-4222-8222-222222222222';
    execute
      .mockResolvedValueOnce([]) // no refusal stored on the account itself
      .mockResolvedValueOnce([{ user_id: U, advertising_granted: false, last_grant_type: 'explicit' }]); // …but on its linked browser
    const r = await new AdvertisingRefusalReader(refusedAmong).refused({ userId: U, fpClientIds: [] });
    expect(r).toBe(true);
    expect(text(execute.mock.calls[1][0])).toContain('from identity_links il join consent_current_state cs');
  });
  it(`the segment service reads consent once per ${CONSENT_CHUNK} members; an unreadable chunk is excluded whole`, async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `c${String(i).padStart(5, '0')}`);
    const segments = {
      findById: async () => ({ id: 's1', key: 'k', name: 'K', status: 'ACTIVE', lastMaterialisedAt: new Date('2026-09-24T00:00:00Z') }),
      listMembers: async (_id: string, limit: number, after: string | null) => { const start = after ? ids.indexOf(after) + 1 : 0; return ids.slice(start, start + limit).map((canonicalCustomerId) => ({ canonicalCustomerId })); },
    };
    const contacts = { contactsFor: async (l: string[]) => l.map((id) => ({ canonicalCustomerId: id, accountUserId: null, email: `${id}@example.com`, phone: null, fpClientIds: [`fp.${id}`] })) };
    let call = 0;
    const advertising = {
      refused: vi.fn(),
      refusedMany: vi.fn(async (subjects: Array<{ key: string }>) => { call++; if (call === 2) throw new Error('db'); return new Set([subjects[0].key]); }),
    };
    const r = await new SegmentAudienceService(segments as any, contacts as any, advertising as any, {} as any).advertisingAudience('s1', { limit: 100_000 });
    expect(advertising.refusedMany).toHaveBeenCalledTimes(3); // 500 + 500 + 200
    expect(advertising.refused).not.toHaveBeenCalled();
    expect(r.excludedConsentUnknown).toBe(500);
    expect(r.excludedAdvertisingRefused).toBe(2);
    expect(r.members).toHaveLength(1200 - 500 - 2);
  });
});

// ── A refusal follows the person through a fold ─────────────────────────────

/** A tiny in-memory model of customer_consent_anchors that applies copyConsentAnchorsSql. */
function anchorTable(initial: Array<{ canonical: string; fp: string }>) {
  const rows = [...initial];
  const apply = (q: any) => {
    const { sql: s, params } = render(q);
    if (!/insert into customer_consent_anchors/.test(s)) return [];
    const [into, from] = params as string[];
    for (const r of rows.filter((x) => x.canonical === from)) if (!rows.some((x) => x.canonical === into && x.fp === r.fp)) rows.push({ canonical: into, fp: r.fp });
    return [];
  };
  /** What every advertising consent read does: anchors joined on the CURRENT profile id. */
  const browsersOf = (canonical: string) => rows.filter((r) => r.canonical === canonical).map((r) => r.fp);
  return { rows, apply, browsersOf };
}

function fakeTx(anchors: ReturnType<typeof anchorTable>, opts: { marked?: boolean; linkOwner?: string } = {}) {
  const chain = (result: unknown) => {
    const c: any = { set: () => c, where: () => c, from: () => c, limit: async () => result, returning: async () => result };
    return c;
  };
  return {
    update: vi.fn(() => chain(opts.marked === false ? [] : [{ id: 'x' }])),
    select: vi.fn(() => chain(opts.linkOwner ? [{ from: opts.linkOwner }] : [])),
    execute: vi.fn(async (q: any) => anchors.apply(q)),
  };
}

describe('a guest who refused advertising is still excluded after their profile is folded', () => {
  const GUEST = randomUUID(), ACCOUNT = randomUUID();
  it('fold: the refused browser anchor is copied to the target profile in the same transaction', async () => {
    const anchors = anchorTable([{ canonical: GUEST, fp: 'fp.guest.refused' }]);
    const tx = fakeTx(anchors);
    transaction.mockImplementation(async (fn: any) => fn(tx));
    expect(anchors.browsersOf(ACCOUNT)).toEqual([]);
    const r = await new DrizzleIdentityMergeRepository().foldGuestInto(GUEST, ACCOUNT);
    expect(r).toEqual({ folded: true, movedLinks: 1 });
    expect(tx.execute).toHaveBeenCalledTimes(1);
    // The consent reads join anchors on the profile the order now belongs to: the refused browser is there.
    expect(anchors.browsersOf(ACCOUNT)).toContain('fp.guest.refused');
    // Idempotent.
    await tx.execute(copyConsentAnchorsSql(GUEST, ACCOUNT));
    expect(anchors.browsersOf(ACCOUNT)).toEqual(['fp.guest.refused']);
  });
  it('a fold that did not happen copies nothing', async () => {
    const anchors = anchorTable([{ canonical: GUEST, fp: 'fp.guest.refused' }]);
    const tx = fakeTx(anchors, { marked: false });
    transaction.mockImplementation(async (fn: any) => fn(tx));
    expect(await new DrizzleIdentityMergeRepository().foldGuestInto(GUEST, ACCOUNT)).toEqual({ folded: false, movedLinks: 0 });
    expect(tx.execute).not.toHaveBeenCalled();
  });
  it('reassigning a link (conflict resolution) copies the old profile\'s anchors too', async () => {
    const anchors = anchorTable([{ canonical: GUEST, fp: 'fp.guest.refused' }]);
    const tx = fakeTx(anchors, { linkOwner: GUEST });
    transaction.mockImplementation(async (fn: any) => fn(tx));
    await new DrizzleIdentityMergeRepository().reassignLink(randomUUID(), ACCOUNT);
    expect(anchors.browsersOf(ACCOUNT)).toContain('fp.guest.refused');
    expect(anchors.browsersOf(GUEST)).toContain('fp.guest.refused'); // copied, not moved: it only ever excludes
  });
});

// ── Privacy idempotency ─────────────────────────────────────────────────────

describe('privacy request idempotency keys are per customer and per kind', () => {
  const A = randomUUID(), B = randomUUID();
  it('the same client key never collides across customers or kinds, and fits the column', () => {
    const k = 'retry-123';
    expect(scopedIdempotencyKey(A, 'EXPORT', k)).not.toBe(scopedIdempotencyKey(B, 'EXPORT', k));
    expect(scopedIdempotencyKey(A, 'EXPORT', k)).not.toBe(scopedIdempotencyKey(A, 'DELETE_ACCOUNT', k));
    expect(scopedIdempotencyKey(A, 'EXPORT', k)).toBe(scopedIdempotencyKey(A, 'EXPORT', k));
    expect(scopedIdempotencyKey(A, 'EXPORT', 'x'.repeat(200))).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a key already used for another kind does not return that record; the insert carries the scoped key', async () => {
    const queue: unknown[][] = [
      [{ id: randomUUID(), userId: A, kind: 'EXPORT', status: 'COMPLETED', reference: 'PR-1', result: {}, requestedAt: new Date() }], // same key row, other kind
      [], // no open request of this kind
    ];
    const chain = () => { const c: any = { from: () => c, where: () => c, orderBy: () => c, limit: async () => queue.shift() ?? [] }; return c; };
    select.mockImplementation(chain);
    let inserted: any = null;
    insert.mockImplementation(() => ({ values: (v: any) => { inserted = v; return { onConflictDoNothing: () => ({ returning: async () => [{ ...v, id: randomUUID(), requestedAt: new Date(), result: {} }] }) }; } }));
    const r = await new DrizzlePrivacyRequestRepository().create({ reference: 'PR-2', userId: A, kind: 'ANONYMISE_HISTORY', status: 'RECEIVED', customerNote: null, idempotencyKey: 'retry-123' } as any);
    expect(r.created).toBe(true);
    expect(r.record.kind).toBe('ANONYMISE_HISTORY');
    expect(inserted.idempotencyKey).toBe(scopedIdempotencyKey(A, 'ANONYMISE_HISTORY', 'retry-123'));
  });
});

// ── Erasure ─────────────────────────────────────────────────────────────────

describe('erasure: nothing left behind, nothing sent afterwards, refusals kept', () => {
  const USER = randomUUID(), REQ = randomUUID(), ORDER = randomUUID(), QUOTE = randomUUID(), BATTERY = randomUUID();
  const PEPPER = 'p'.repeat(40);

  function run(opts: { hashedEmailKey?: string; quotePages?: Array<Array<{ id: string; email: string; phone: string }>> } = {}) {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const pages = [...(opts.quotePages ?? [])];
    const tx = {
      execute: vi.fn(async (q: any) => {
        const r = render(q);
        const s = r.sql.replace(/\s+/g, ' ').trim();
        statements.push({ sql: s, params: r.params });
        if (s.startsWith('update privacy_requests set status')) return [{ id: REQ }];
        if (s.startsWith('select email, phone from users')) return [{ email: 'Jane@Example.com', phone: '0772 123 456' }];
        if (s.includes('select l.identifier_key from customer_identity_links')) return [];
        if (s.startsWith('select id from orders where user_id')) return [{ id: ORDER }];
        if (s.includes('select l.signal_type, l.identifier_key')) return opts.hashedEmailKey ? [{ signal_type: 'CONTACT_EMAIL', identifier_key: opts.hashedEmailKey }] : [];
        if (s.startsWith('select customer_email, customer_phone from orders')) return [{ customer_email: 'jane.work@example.com', customer_phone: '+256 772 123456' }];
        if (s.startsWith('select id from quote_requests where')) return [{ id: QUOTE }];
        if (s.startsWith('select id from battery_requests where')) return [{ id: BATTERY }];
        if (s.startsWith('select id, email, phone from quote_requests')) return pages.shift() ?? [];
        return [];
      }),
    };
    transaction.mockImplementation(async (fn: any) => fn(tx));
    return { statements, go: () => new DrizzlePersonalDataEraser(new HmacIdentifierHasher(PEPPER)).erase({ userId: USER, kind: 'ANONYMISE_HISTORY', requestId: REQ, actorId: randomUUID(), reason: 'checked' }) };
  }

  it('matches quotes and battery requests in SQL with no limit, by every known email and phone spelling', async () => {
    const { statements, go } = run();
    expect((await go()).completed).toBe(true);
    expect(statements.some((s) => /limit 5000/.test(s.sql))).toBe(false);
    const quoteMatch = statements.find((s) => s.sql.startsWith('select id from quote_requests where'))!;
    expect(quoteMatch.sql).toContain("regexp_replace(coalesce(phone, ''), '\\D', '', 'g')");
    expect(quoteMatch.sql).toContain('lower(trim(coalesce(email');
    const params = JSON.stringify(quoteMatch.params);
    for (const v of ['256772123456', '0772123456', 'jane@example.com', 'jane.work@example.com']) expect(params).toContain(v);
    const quoteUpdate = statements.find((s) => s.sql.startsWith('update quote_requests set'))!;
    expect(quoteUpdate.params).toContain(QUOTE);
    const batteryMatch = statements.find((s) => s.sql.startsWith('select id from battery_requests where'))!;
    expect(batteryMatch.sql).toContain("regexp_replace(coalesce(contact_phone, ''), '\\D', '', 'g')");
    // No hashed-only keys: no scan at all.
    expect(statements.some((s) => s.sql.startsWith('select id, email, phone from quote_requests'))).toBe(false);
  });
  it('contacts known only as identity hashes are found by a paged scan of EVERY row (no window)', async () => {
    const hashed = new HmacIdentifierHasher(PEPPER).hash('old.address@example.com')!;
    const filler = (n: number) => Array.from({ length: n }, () => ({ id: randomUUID(), email: 'someone@else.com', phone: '0700000000' }));
    const hit = { id: randomUUID(), email: 'Old.Address@example.com', phone: '' };
    const { statements, go } = run({ hashedEmailKey: hashed, quotePages: [filler(2000), [hit]] });
    await go();
    const scans = statements.filter((s) => s.sql.startsWith('select id, email, phone from quote_requests'));
    expect(scans).toHaveLength(2); // a full page, then the rest
    expect(scans[0].sql).toContain('order by id limit');
    const update = statements.find((s) => s.sql.startsWith('update quote_requests set'))!;
    expect(update.params).toContain(hit.id);
    expect(update.params).toContain(QUOTE);
  });
  it('removes ad click ids, suppresses waiting offline conversions, and KEEPS the consent anchors', async () => {
    const { statements, go } = run();
    const r = await go();
    expect(statements.find((s) => s.sql.startsWith('update order_attribution'))!.sql).toContain('click_ids = null');
    const suppress = statements.find((s) => s.sql.startsWith('update ad_offline_conversions'))!;
    expect(suppress.sql).toContain("state = 'SUPPRESSED', reason = 'ERASED'");
    expect(suppress.sql).toContain("where state = 'PENDING'");
    expect(suppress.sql).toContain("source = 'COD_DELIVERED'");
    expect(suppress.sql).toContain("source = 'ADMIN_SALE' and source_ref in (select id::text from ad_offline_sales");
    expect(suppress.params).toContain(ORDER);
    // Suppressed before the sales lose the hashes that find them.
    const order = statements.map((s) => s.sql.slice(0, 30));
    expect(order.findIndex((x) => x.startsWith('update ad_offline_conversions'))).toBeLessThan(order.findIndex((x) => x.startsWith('update ad_offline_sales')));
    expect(statements.some((s) => /customer_consent_anchors/.test(s.sql))).toBe(false);
    expect(r.counts).not.toHaveProperty('consentAnchors');
  });
});
