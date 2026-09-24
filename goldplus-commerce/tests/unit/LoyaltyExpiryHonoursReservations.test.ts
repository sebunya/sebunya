import { describe, expect, it, vi } from 'vitest';
import {
  computeExpirableEarns,
  computeEarnRemainders,
  soonestUnspentExpiry,
  type LoyaltyLedgerEntry,
} from '../../apps/api/src/domain/loyalty/LoyaltyLedger';
import { ConsumeRedemptionUseCase, RunLoyaltyDailySweepUseCase } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases';

const day = 86_400_000;
const now = new Date('2026-09-24T00:00:00Z');
let n = 0;
const entry = (type: LoyaltyLedgerEntry['type'], points: number, over: Partial<LoyaltyLedgerEntry> = {}): LoyaltyLedgerEntry => ({
  id: `e${++n}`, accountId: 'acc', type, points, orderId: null, reason: type, idempotencyKey: `k${n}`, expiresAt: null, reversedEntryId: null,
  createdAt: new Date(now.getTime() - 100 * day + n), ...over,
});

describe('expiry never claims points held by an open reservation', () => {
  it('reserved points are allocated FIFO before expiry', () => {
    const earn = entry('earn', 1_000, { expiresAt: new Date(now.getTime() - day) });
    expect(computeExpirableEarns([earn], now)).toHaveLength(1);
    expect(computeExpirableEarns([earn], now, 1_000)).toHaveLength(0);
    expect(computeExpirableEarns([earn], now, 400)[0].points).toBe(600);
  });

  it('the repository reads open reservations inside the expiry lock', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/computeExpirableEarns\(rows\.map\(toDomain\), now, Number\(held\?\.reserved \?\? 0\)\)/);
  });
});

describe('a failed consume at delivery is reported and stops haunting the balance', () => {
  it('releases the stuck reservation and records an ops signal', async () => {
    const reservation = { id: 'r1', accountId: 'acc', orderId: 'o1', status: 'reserved', pointsReserved: 1_000, valueUgx: 20_000, pointValueUgx: 20, ledgerEntryId: null };
    const completion = {
      findReservationByOrder: vi.fn().mockResolvedValue(reservation),
      markReservation: vi.fn().mockResolvedValue(true),
      recordFraudSignal: vi.fn().mockResolvedValue(undefined),
    };
    const repo = { appendDebitIfAvailable: vi.fn().mockResolvedValue({ ok: false, code: 'INSUFFICIENT_BALANCE' }) };
    const out = await new ConsumeRedemptionUseCase(repo as never, completion as never).settleOnDelivery('o1');
    expect(out).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE' });
    expect(completion.recordFraudSignal).toHaveBeenCalledWith(expect.objectContaining({ signalType: 'REDEMPTION_CONSUME_FAILED_AT_DELIVERY' }));
    expect(completion.markReservation).toHaveBeenCalledWith('r1', 'released');
  });
});

describe('a debit during a redemption pause expires nothing on the side', () => {
  const reservation = { id: 'r2', accountId: 'acc', orderId: 'o2', status: 'reserved', pointsReserved: 500, valueUgx: 10_000, pointValueUgx: 20, ledgerEntryId: null };
  const configured = { killSwitch: false, enabled: true, pointValueUgx: 20, redemptionMinPoints: 100, redemptionMaxShareBps: 2_000 };
  const run = async (config: Record<string, unknown>, gateActive = true) => {
    const completion = {
      findReservationByOrder: vi.fn().mockResolvedValue(reservation),
      markReservation: vi.fn().mockResolvedValue(true),
      getProgrammeConfig: vi.fn().mockResolvedValue(config),
    };
    const repo = { appendDebitIfAvailable: vi.fn().mockResolvedValue({ ok: true, entry: { id: 'e1' }, replay: false, expired: [] }) };
    const gate = { isActive: vi.fn().mockResolvedValue(gateActive) };
    await new ConsumeRedemptionUseCase(repo as never, completion as never, gate).execute({ orderId: 'o2' });
    return repo.appendDebitIfAvailable.mock.calls[0][2];
  };

  it('applies a pre-pause reservation without lazy expiry while the kill switch is on', async () => {
    expect(await run({ ...configured, killSwitch: true })).toEqual({ expireDue: false });
    expect(await run(configured, false)).toEqual({ expireDue: false });
    expect(await run({ ...configured, pointValueUgx: null })).toEqual({ expireDue: false });
  });
  it('expires due points first as usual when redemption is live', async () => {
    expect(await run(configured)).toEqual({ expireDue: true });
  });
  it('the repository skips expireDueInTransaction only when told to', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/options\?\.expireDue === false \? \[\] : await expireDueInTransaction\(tx, input\.accountId, now\)/);
  });
});

describe('expiry warnings only for points the customer still holds', () => {
  const earn = entry('earn', 1_000, { expiresAt: new Date(now.getTime() + 7 * day) });
  const spent = entry('redeem', -1_000);

  it('a fully spent earn has no remainder and no soonest expiry', () => {
    expect(computeEarnRemainders([earn, spent])[0].points).toBe(0);
    expect(soonestUnspentExpiry([earn, spent], now)).toBeNull();
    expect(soonestUnspentExpiry([earn], now)?.getTime()).toBe(earn.expiresAt!.getTime());
  });

  it('the sweep sends the remainder, and nothing for a spent earn', async () => {
    const notify = vi.fn().mockResolvedValue('sent');
    const partlySpent = entry('redeem', -600);
    const repo = { listEntries: vi.fn().mockResolvedValue([earn, partlySpent]), expireDue: vi.fn().mockResolvedValue([]), getConfig: vi.fn().mockResolvedValue({ earnRatePer1000Ugx: 10 }), mergedInto: vi.fn().mockResolvedValue(null) };
    const completion = {
      getProgrammeConfig: vi.fn().mockResolvedValue({ enabled: true, killSwitch: false, pointValueUgx: 20, redemptionMinPoints: 100, redemptionMaxShareBps: 2000 }),
      listExpiredReservations: vi.fn().mockResolvedValue([]),
      listAccountIds: vi.fn().mockResolvedValue([]),
      listEarnsNearingExpiry: vi.fn().mockResolvedValue([{ entry: earn, userId: 'u1' }]),
      noticeAlreadySent: vi.fn().mockResolvedValue(false),
      recordNotice: vi.fn(),
      reservedPoints: vi.fn().mockResolvedValue(0),
      ledgerTotals: vi.fn().mockResolvedValue({ issued: 0, redeemed: 0, expired: 0, outstanding: 0 }),
      writeLiabilitySnapshot: vi.fn(),
    };
    await new RunLoyaltyDailySweepUseCase(repo as never, completion as never, notify).execute(now).catch(() => undefined);
    expect(notify).toHaveBeenCalled();
    for (const call of notify.mock.calls) expect(call[0].pointsExpiring).toBe(400);

    notify.mockClear();
    repo.listEntries.mockResolvedValue([earn, spent]);
    await new RunLoyaltyDailySweepUseCase(repo as never, completion as never, notify).execute(now).catch(() => undefined);
    expect(notify).not.toHaveBeenCalled();
  });
});
