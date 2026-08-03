import { describe, expect, it } from 'vitest';
import {
  ABANDONMENT_STALE_HOURS,
  AbandonmentCandidate,
  AbandonmentRecord,
  AbandonmentUseCase,
  IAbandonmentRepository,
} from '../../apps/api/src/application/use-cases/abandonment/AbandonmentUseCase';

/**
 * Wave 2E-1: the evaluator is the single writer of "abandoned". Idempotent (open
 * rows never re-classified), empty baskets never classified, every NEW
 * classification announced exactly once, overdue rows expired.
 */

class FakeRepo implements IAbandonmentRepository {
  candidates: AbandonmentCandidate[] = [];
  openCartIds = new Set<string>();
  created: AbandonmentRecord[] = [];
  expiredCount = 0;
  private seq = 0;

  async findNewlyAbandoned(staleBefore: Date) {
    return this.candidates.filter(
      (c) => c.lastActivityAt.getTime() < staleBefore.getTime() && !this.openCartIds.has(c.cartId),
    );
  }
  async createOpen(candidate: AbandonmentCandidate) {
    if (this.openCartIds.has(candidate.cartId)) return null; // unique index behaviour
    this.openCartIds.add(candidate.cartId);
    const rec: AbandonmentRecord = {
      id: `ab-${++this.seq}`,
      cartId: candidate.cartId,
      status: 'OPEN',
      reason: 'STALE_TIMEOUT',
      itemCount: candidate.itemCount,
      subtotalUgx: candidate.subtotalUgx,
      classifiedAt: new Date(0),
      lastActivityAt: candidate.lastActivityAt,
    };
    this.created.push(rec);
    return rec;
  }
  async expireOverdue() {
    return this.expiredCount;
  }
  async summary() {
    return { open: this.openCartIds.size, expired: 0, recovered: 0, last24h: 0 };
  }
  async recent() {
    return this.created;
  }
}

const NOW = new Date('2026-08-03T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const candidate = (cartId: string, itemCount: number, hoursStale: number): AbandonmentCandidate => ({
  cartId,
  ownerKind: 'GUEST',
  ownerId: 'g1',
  itemCount,
  subtotalUgx: 50_000 * itemCount,
  lastActivityAt: hoursAgo(hoursStale),
  expiresAt: null,
});

describe('AbandonmentUseCase.scan', () => {
  it('classifies stale carts with items and announces each exactly once', async () => {
    const repo = new FakeRepo();
    const published: string[] = [];
    repo.candidates = [candidate('c1', 2, ABANDONMENT_STALE_HOURS + 1), candidate('c2', 1, ABANDONMENT_STALE_HOURS + 5)];
    const useCase = new AbandonmentUseCase(repo, { publish: async (r) => void published.push(r.cartId) }, () => NOW);
    const result = await useCase.scan();
    expect(result.classified).toBe(2);
    expect(published.sort()).toEqual(['c1', 'c2']);
    // Second scan: idempotent — nothing new, nothing re-announced.
    const again = await useCase.scan();
    expect(again.classified).toBe(0);
    expect(published).toHaveLength(2);
  });

  it('never classifies a fresh cart or an empty basket', async () => {
    const repo = new FakeRepo();
    const published: string[] = [];
    repo.candidates = [
      candidate('fresh', 3, ABANDONMENT_STALE_HOURS - 1), // not stale yet
      candidate('empty', 0, ABANDONMENT_STALE_HOURS + 2), // no items
    ];
    const useCase = new AbandonmentUseCase(repo, { publish: async (r) => void published.push(r.cartId) }, () => NOW);
    const result = await useCase.scan();
    expect(result.classified).toBe(0);
    expect(published).toEqual([]);
  });

  it('reports expiries from the same pass', async () => {
    const repo = new FakeRepo();
    repo.expiredCount = 3;
    const useCase = new AbandonmentUseCase(repo, { publish: async () => {} }, () => NOW);
    expect((await useCase.scan()).expired).toBe(3);
  });
});
