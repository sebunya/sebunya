import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApplyRefundToLoyaltyUseCase,
  ReverseReferralOnRefundUseCase,
  type ReferralRefundPort,
} from '../../apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases';
import { MergeLoyaltyAccountsUseCase } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyIdentityUseCases';

const root = join(__dirname, '../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

function referralFakes(awarded: { id: string; referrerEntryId: string | null; refereeEntryId: string | null } | null) {
  const reversed: string[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  let current = awarded;
  const referrals: ReferralRefundPort = {
    async findAwardedByQualifyingOrder() { return current; },
    async markRejected(id, reason) { rejected.push({ id, reason }); current = null; },
  };
  const ledger = {
    async reverseEntry(entryId: string) {
      if (reversed.includes(entryId)) return { ok: false as const, code: 'ALREADY_REVERSED' as const };
      reversed.push(entryId);
      return { ok: true as const, entry: {} as never, replay: false };
    },
  };
  return { referrals, ledger, reversed, rejected };
}

describe('a refunded qualifying order takes the referral back (2026-10-07)', () => {
  it('reverses both payouts and stops the referral counting as awarded', async () => {
    const f = referralFakes({ id: 'ref-1', referrerEntryId: 'e-referrer', refereeEntryId: 'e-referee' });
    const uc = new ReverseReferralOnRefundUseCase(f.referrals, f.ledger);
    expect(await uc.execute({ orderId: 'o-1', reason: 'Refund' })).toEqual({ reversed: true });
    expect(f.reversed).toEqual(['e-referrer', 'e-referee']);
    expect(f.rejected).toEqual([{ id: 'ref-1', reason: 'QUALIFYING_ORDER_REFUNDED' }]);
    // A second run (retry, second refund webhook) changes nothing.
    expect(await uc.execute({ orderId: 'o-1', reason: 'Refund' })).toEqual({ reversed: false });
    expect(f.reversed).toHaveLength(2);
  });

  it('an order that qualified no referral is left alone', async () => {
    const f = referralFakes(null);
    expect(await new ReverseReferralOnRefundUseCase(f.referrals, f.ledger).execute({ orderId: 'o-2', reason: 'Refund' })).toEqual({ reversed: false });
    expect(f.reversed).toEqual([]);
  });

  it('only a FULL refund reverses the referral; a partial one keeps it', async () => {
    const calls: number[] = [];
    const noop = { execute: async () => undefined } as never;
    const referral = { execute: async () => { calls.push(1); return { reversed: true }; } };
    const uc = new ApplyRefundToLoyaltyUseCase(noop, noop, referral);
    await uc.execute({ orderId: 'o', refundedShareBps: 5_000, reason: 'part' });
    expect(calls).toHaveLength(0);
    await uc.execute({ orderId: 'o', refundedShareBps: 10_000, reason: 'all' });
    expect(calls).toHaveLength(1);
  });

  it('every refund path in the registry passes the referral reversal', () => {
    const r = read('apps/api/src/infrastructure/Registry.ts');
    expect(r.match(/new ApplyRefundToLoyaltyUseCase\(/g)?.length).toBe(r.match(/new ApplyRefundToLoyaltyUseCase\([^)]*this\.reverseReferralOnRefundUseCase\)/g)?.length);
    expect(r).toMatch(/this\.reverseReferralOnRefundUseCase\.execute\(\{ orderId, reason: 'Payment reversed by provider' \}\)/);
  });
});

describe('a chained loyalty merge is refused (2026-10-07)', () => {
  it('cannot merge away an account that already holds merged accounts', async () => {
    const identity = {
      async mergedInto() { return null; },
      async mergedSources(id: string) { return id === 'B' ? ['A'] : []; },
      async recordMerge() { return true; },
    } as never;
    const audit = { async create() { return undefined; }, async save() { return undefined; } } as never;
    const uc = new MergeLoyaltyAccountsUseCase(identity, audit);
    const r = await uc.execute({ mergedAccountId: 'B', survivorAccountId: 'C', actorId: 'admin', note: 'duplicate' });
    expect(r).toMatchObject({ ok: false, code: 'MERGED_HAS_SOURCES' });
  });
});

describe('MTN/Airtel webhooks cannot overwrite a paid order or lose money (2026-10-07)', () => {
  const repo = read('apps/api/src/infrastructure/db/repositories/DrizzlePaymentRepository.ts');
  it('a late FAILED never writes over paid or reversed', () => {
    expect(repo).toMatch(/notInArray\(orders\.paymentStatus, \['paid', 'reversed'\]\)/);
  });
  it('the decision is taken on the locked order row', () => {
    expect(repo).toMatch(/\.for\('update'\)/);
    expect(repo).toMatch(/const requiresReview = requestedReview \|\| alreadyPaid \|\| cannotProcess;/);
  });
  it('money for an order that cannot move to processing is recorded for review, not rolled back', () => {
    expect(repo).toMatch(/PAYABLE_ORDER_STATUSES: readonly string\[\] = \['received', 'pending_payment', 'pending_owner_review'\]/);
  });
});

describe('website-relayed forms are rate-limited per visitor (2026-10-07)', () => {
  it('postJson forwards the visitor address, and every public form passes it', () => {
    expect(read('apps/web/src/lib/api.ts')).toMatch(/headers: apiHeaders\(\{ 'Content-Type': 'application\/json'[^\n]*clientAddress\)/);
    for (const page of ['track-order', 'quote-request', 'support/fake', 'support/issue', 'dealers/apply', 'verification/index']) {
      const src = read(`apps/web/src/pages/${page}.astro`);
      const calls = src.match(/postJson\([\s\S]*?\)\);?/g) ?? [];
      expect(calls.length, page).toBeGreaterThan(0);
      for (const c of calls) expect(c, page).toMatch(/readClientAddress\(Astro\)/);
    }
  });

  it('the admin sign-in is attributed to the visitor, not the web container', () => {
    expect(read('apps/web/src/pages/admin/login.astro')).toMatch(/headers: apiHeaders\(\{ 'Content-Type': 'application\/json' \}, readClientAddress\(Astro\)\)/);
  });
});
