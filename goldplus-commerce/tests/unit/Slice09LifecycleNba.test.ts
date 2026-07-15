import { describe, it, expect } from 'vitest';
import {
  lifecycleStage,
  nextBestAction,
  LIFECYCLE_THRESHOLDS,
} from '../../apps/api/src/domain/identity/CustomerLifecycle';
import { GetLifecycleSegmentsUseCase } from '../../apps/api/src/application/use-cases/identity/GetLifecycleSegmentsUseCase';
import { ILifecycleReadRepository, CustomerOrderStats } from '../../apps/api/src/application/ports/ILifecycleReadRepository';
import { ConsentState } from '../../apps/api/src/domain/identity/CustomerLifecycle';

const now = new Date('2026-07-15T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

describe('Customer lifecycle domain (Slice 9, pure)', () => {
  it('derives stages deterministically from real order history with explanations', () => {
    expect(lifecycleStage({ ordersCount: 0, firstOrderAt: null, lastOrderAt: null }, now).stage).toBe('prospect');
    expect(lifecycleStage({ ordersCount: 1, firstOrderAt: daysAgo(10), lastOrderAt: daysAgo(10) }, now).stage).toBe('new');
    expect(lifecycleStage({ ordersCount: 3, firstOrderAt: daysAgo(300), lastOrderAt: daysAgo(30) }, now).stage).toBe('active');
    expect(lifecycleStage({ ordersCount: 3, firstOrderAt: daysAgo(300), lastOrderAt: daysAgo(120) }, now).stage).toBe('at_risk');
    expect(lifecycleStage({ ordersCount: 3, firstOrderAt: daysAgo(600), lastOrderAt: daysAgo(200) }, now).stage).toBe('dormant');
    const staged = lifecycleStage({ ordersCount: 3, firstOrderAt: daysAgo(300), lastOrderAt: daysAgo(120) }, now);
    expect(staged.explanation).toContain('120 days');
    expect(LIFECYCLE_THRESHOLDS.activeDays).toBe(90);
  });

  it('suppresses every action without an explicit consent grant — unknown is not consent', () => {
    for (const consent of ['unknown', 'denied'] as const) {
      const nba = nextBestAction('active', consent);
      expect(nba.suppressed).toBe(true);
      expect(nba.action).toBe('suppressed');
    }
    const granted = nextBestAction('active', 'granted');
    expect(granted.suppressed).toBe(false);
    expect(granted.action).toBe('complete_the_set_review');
    expect(granted.explanation.length).toBeGreaterThan(10);
  });
});

describe('Lifecycle segments use case (Slice 9)', () => {
  function fakeReads(stats: CustomerOrderStats[], consent: Record<string, ConsentState>): ILifecycleReadRepository {
    return {
      async listCustomerOrderStats() { return stats; },
      async getPersonalisationConsent(ids) {
        return new Map(ids.map((id) => [id, consent[id] ?? 'unknown']));
      },
    };
  }

  it('aggregates totals, counts suppressions, and exposes no contact details', async () => {
    const uc = new GetLifecycleSegmentsUseCase(fakeReads([
      { userId: 'u1', ordersCount: 2, firstOrderAt: daysAgo(200), lastOrderAt: daysAgo(10) },
      { userId: 'u2', ordersCount: 1, firstOrderAt: daysAgo(400), lastOrderAt: daysAgo(400) },
    ], { u1: 'granted' }));
    const report = await uc.execute();
    expect(report.totals.active).toBe(1);
    expect(report.totals.dormant).toBe(1);
    expect(report.suppressedCount).toBe(1); // u2 unknown consent
    expect(report.customers.find((c) => c.userId === 'u1')?.nba.suppressed).toBe(false);
    for (const row of report.customers) {
      expect(Object.keys(row).sort()).toEqual(['lastOrderAt', 'nba', 'ordersCount', 'stage', 'stageExplanation', 'userId']);
    }
  });

  it('handles the empty state without inventing customers', async () => {
    const report = await new GetLifecycleSegmentsUseCase(fakeReads([], {})).execute();
    expect(report.customers).toEqual([]);
    expect(Object.values(report.totals).every((n) => n === 0)).toBe(true);
  });
});
