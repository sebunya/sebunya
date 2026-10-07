import { describe, expect, it } from 'vitest';
import { computeFeatures, isPurchase, numericFeature, type RawCustomerSignals } from '../../apps/api/src/domain/customer-dna/CustomerFeatures';
import { ProjectCustomerProfileUseCase, ReprojectStaleProfilesUseCase } from '../../apps/api/src/application/use-cases/customer-dna/CustomerDnaUseCases';

const now = new Date('2026-10-07T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const signals = (over: Partial<RawCustomerSignals> = {}): RawCustomerSignals => ({
  sourceVersion: 1, orders: [], searches: null, deliveries: [], backorderCount: 0,
  supportInteractions: 0, cartAbandonments: 0, loyaltyBalance: null, declaredPreferences: null, ...over,
});
const order = (o: Partial<{ totalAmountUgx: number; createdAt: Date; paymentMethod: string | null; status: string; paymentStatus: string | null }>) => ({
  totalAmountUgx: 100_000, createdAt: daysAgo(5), paymentMethod: 'pesapal', status: 'processing', paymentStatus: 'paid', ...o,
});

describe('a purchase is what the shop counts as one (2026-10-07)', () => {
  it('paid online, or cash on delivery once delivered; never unpaid, failed, cancelled or reversed', () => {
    expect(isPurchase(order({}))).toBe(true);
    expect(isPurchase(order({ paymentMethod: 'offline', paymentStatus: 'unpaid', status: 'delivered' }))).toBe(true);
    expect(isPurchase(order({ paymentMethod: 'offline', paymentStatus: 'unpaid', status: 'processing' }))).toBe(false);
    expect(isPurchase(order({ paymentStatus: 'unpaid', status: 'received' }))).toBe(false);
    expect(isPurchase(order({ paymentStatus: 'failed', status: 'received' }))).toBe(false);
    expect(isPurchase(order({ status: 'cancelled' }))).toBe(false);
    expect(isPurchase(order({ paymentStatus: 'reversed' }))).toBe(false);
  });

  it('an abandoned online checkout does not add to lifetime value or order count', () => {
    const f = computeFeatures(signals({ orders: [order({ totalAmountUgx: 200_000 }), order({ totalAmountUgx: 900_000, paymentStatus: 'unpaid', status: 'received' })] }), now);
    expect(numericFeature(f, 'order_count')).toBe(1);
    expect(numericFeature(f, 'lifetime_value_ugx')).toBe(200_000);
  });
});

describe('no invented observations (2026-10-07)', () => {
  it('searches that are not read are NOT_OBSERVED, never 0', () => {
    const f = computeFeatures(signals(), now);
    expect(f.find((x) => x.key === 'search_frequency')!.value).toBe('NOT_OBSERVED');
    expect(f.find((x) => x.key === 'zero_result_search_count')!.value).toBe('NOT_OBSERVED');
  });

  it('a reschedule is not a failed delivery', () => {
    const f = computeFeatures(signals({ deliveries: [
      { outcome: 'RESCHEDULED', createdAt: daysAgo(6) },
      { outcome: 'DELIVERED', createdAt: daysAgo(5) },
    ] }), now);
    expect(numericFeature(f, 'delivery_success_rate')).toBe(1);
  });
});

function projectHarness(orders: ReturnType<typeof order>[], consent?: 'granted' | 'denied' | 'unknown') {
  const saved: any[] = [];
  const profile = { canonicalCustomerId: 'c1', profileVersion: 1, sourceVersion: 0, accountUserId: 'u1', firstSeen: null, lastSeen: null } as any;
  const uc = new ProjectCustomerProfileUseCase(
    { async findByCanonicalId() { return profile; }, async upsertProjection(s: any) { saved.push(s); return { updated: true, profileVersion: 2 }; } } as never,
    { async listLinks() { return []; } } as never,
    { async saveSnapshot() { return { created: true }; } } as never,
    { async saveSnapshot() { return { created: true }; } } as never,
    { async readSignals() { return signals({ orders }); } } as never,
    { async save() { return undefined; } } as never,
    consent ? { async getPersonalisationConsent(ids: string[]) { return new Map(ids.map((id) => [id, consent])); } } : undefined,
  );
  return { uc, saved };
}

describe('the profile stage reflects purchases and time (2026-10-07)', () => {
  it('a customer whose only order is an unpaid checkout is still a PROSPECT', async () => {
    const h = projectHarness([order({ paymentStatus: 'unpaid', status: 'received' })]);
    await h.uc.execute({ canonicalCustomerId: 'c1', actorId: 'a', now });
    expect(h.saved[0].primaryLifecycleStage).toBe('PROSPECT');
    expect(h.saved[0].lastSeen).toEqual(daysAgo(5)); // seen, though not a buyer
  });

  it('the same data later in time moves the stage on (ACTIVE -> AT_RISK)', async () => {
    const orders = [order({ createdAt: daysAgo(200) }), order({ createdAt: daysAgo(150) }), order({ createdAt: daysAgo(100) }), order({ createdAt: daysAgo(40) })];
    const h = projectHarness(orders);
    await h.uc.execute({ canonicalCustomerId: 'c1', actorId: 'a', now });
    await h.uc.execute({ canonicalCustomerId: 'c1', actorId: 'a', now: new Date(now.getTime() + 40 * 86_400_000) });
    expect(h.saved.map((s) => s.primaryLifecycleStage)).toEqual(['ACTIVE', 'AT_RISK']);
  });

  it('consent comes from the consent system, not a hard-coded UNKNOWN', async () => {
    const yes = projectHarness([order({})], 'granted');
    await yes.uc.execute({ canonicalCustomerId: 'c1', actorId: 'a', now });
    expect(yes.saved[0].consentEligible).toBe(true);
    const no = projectHarness([order({})], 'denied');
    await no.uc.execute({ canonicalCustomerId: 'c1', actorId: 'a', now });
    expect(no.saved[0].consentEligible).toBe(false);
  });
});

describe('nightly re-projection (2026-10-07)', () => {
  it('projects the oldest profiles, and one failure never stops the batch', async () => {
    const seen: string[] = [];
    const uc = new ReprojectStaleProfilesUseCase(
      { async listForReprojection() { return ['a', 'b', 'c']; } },
      { async execute({ canonicalCustomerId }: { canonicalCustomerId: string }) {
        seen.push(canonicalCustomerId);
        if (canonicalCustomerId === 'b') throw new Error('boom');
        return { ok: true as const, advanced: canonicalCustomerId === 'a', sourceVersion: 1 };
      } },
    );
    expect(await uc.execute({ limit: 10, olderThanHours: 20, now })).toEqual({ attempted: 3, advanced: 1, failed: 1 });
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});
