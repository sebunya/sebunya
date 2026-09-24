import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveControlTotals, businessDateEndUtc, type LedgerEntryForTotals } from '../../apps/api/src/application/use-cases/loyalty/ReconcileLoyaltyControlTotalsUseCase';

/**
 * entriesUpTo loaded the whole ledger (seven times a run). It now returns the
 * day's entries individually and one opening row per account for everything
 * before; the derived totals must be identical.
 */
describe('collapsing history before the day changes no control total', () => {
  const day = '2026-09-20';
  const at = (iso: string) => new Date(iso);
  const full: LedgerEntryForTotals[] = [
    { accountId: 'a', type: 'earn', points: 500, createdAt: at('2026-09-01T10:00:00Z') },
    { accountId: 'a', type: 'redeem', points: -200, createdAt: at('2026-09-10T10:00:00Z') },
    { accountId: 'b', type: 'earn', points: 100, createdAt: at('2026-09-11T10:00:00Z') },
    { accountId: 'b', type: 'expiry', points: -100, createdAt: at('2026-09-12T10:00:00Z') },
    { accountId: 'a', type: 'earn', points: 40, createdAt: at('2026-09-20T08:00:00Z') },
    { accountId: 'c', type: 'earn', points: 10, createdAt: at('2026-09-20T23:59:59Z') },
  ];

  it('matches the full-ledger derivation', () => {
    const end = businessDateEndUtc(day);
    const opening = new Date(end.getTime() - 86_400_000);
    const collapsed: LedgerEntryForTotals[] = [
      { accountId: 'a', type: 'adjustment', points: 300, createdAt: opening },
      { accountId: 'b', type: 'adjustment', points: 0, createdAt: opening },
      ...full.slice(4),
    ];
    expect(deriveControlTotals(day, collapsed)).toEqual(deriveControlTotals(day, full));
  });

  it('the repository aggregates the history in SQL', () => {
    const repo = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyControlTotalsRepository.ts'), 'utf8');
    expect(repo).toContain('sum(points)::bigint as points');
    expect(repo).toContain('group by account_id');
    expect(repo).toContain('union all');
  });
});
