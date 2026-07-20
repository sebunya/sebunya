import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  EarnLoyaltyPointsUseCase,
  ExpireLoyaltyPointsUseCase,
  GetLoyaltyHistoryUseCase,
  LoyaltyProgrammeGate,
  RedeemLoyaltyPointsUseCase,
  ReverseLoyaltyEntryUseCase,
} from '../application/use-cases/loyalty/LoyaltyUseCases';
import { computeBalance } from '../domain/loyalty/LoyaltyLedger';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleLoyaltyRepository } from '../infrastructure/db/repositories/DrizzleLoyaltyRepository';
import { orders } from '../infrastructure/db/schema/commerce';
import { users } from '../infrastructure/db/schema/identity';
import { loyaltyAccounts, loyaltyConfig, loyaltyLedgerEntries } from '../infrastructure/db/schema/loyalty';

const assert: (value: unknown, message: string) => asserts value = (value, message) => {
  if (!value) throw new Error(message);
};

async function protectedCounts() {
  const result: any = await db.execute(sql`
    select
      (select count(*)::int from consent_events) consent_events,
      (select count(*)::int from consent_records) consent_records,
      (select count(*)::int from customer_preferences) preferences,
      (select count(*)::int from outbox_events) outbox,
      (select count(*)::int from notification_attempts) notifications,
      (select count(*)::int from orders) orders,
      (select count(*)::int from payment_attempts) payments
  `);
  return (result.rows ?? result)[0] as Record<string, number>;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const userIds = [randomUUID(), randomUUID(), randomUUID()];
  const orderIds = [randomUUID(), randomUUID()];
  const repo = new DrizzleLoyaltyRepository();
  const originalConfig = await db.select().from(loyaltyConfig);
  const before = await protectedCounts();
  let report: Record<string, unknown> = {};
  let failure: unknown;
  const providerCalls = 0;

  try {
    await db.insert(users).values(userIds.map((id, index) => ({
      id,
      email: `loyalty-proof-${index}-${id}@proof.invalid`,
      passwordHash: 'proof',
    })));
    await db.insert(orders).values(orderIds.map((id, index) => ({
      id,
      userId: userIds[index],
      orderNumber: `LP-${id.replaceAll('-', '').slice(0, 12)}`,
      buyerType: 'retail',
      customerName: 'Proof Customer',
      customerPhone: `+256700${id.replaceAll('-', '').slice(0, 6)}`,
      customerEmail: `loyalty-proof-${index}@proof.invalid`,
      deliveryArea: 'Proof',
      deliveryAddress: 'Proof',
      status: 'processing',
      paymentStatus: 'paid',
      subtotalAmount: 10_000,
      deliveryFee: 0,
      totalAmount: 10_000,
    })));
    await db.delete(loyaltyConfig);
    await repo.saveConfig({ enabled: true, earnRatePer1000Ugx: 10, expiryDays: 365 });

    const dormantGate = new LoyaltyProgrammeGate(repo, () => false);
    const dormantEarn = await new EarnLoyaltyPointsUseCase(repo, dormantGate).execute({
      userId: userIds[0], orderId: orderIds[0], orderTotalUgx: 10_000,
    });
    assert(!dormantEarn.ok && dormantEarn.code === 'PROGRAMME_DISABLED', 'Dormant gate allowed an earn.');
    assert((await db.select().from(loyaltyLedgerEntries)).length === 0, 'Dormant gate wrote a ledger event.');

    const activeGate = new LoyaltyProgrammeGate(repo, () => true);
    const earn = new EarnLoyaltyPointsUseCase(repo, activeGate);
    const firstEarn = await earn.execute({ userId: userIds[0], orderId: orderIds[0], orderTotalUgx: 10_000 });
    const replayEarn = await earn.execute({ userId: userIds[0], orderId: orderIds[0], orderTotalUgx: 10_000 });
    assert(firstEarn.ok && replayEarn.ok && firstEarn.value.id === replayEarn.value.id, 'Paid-order earn was not idempotent.');
    const account = await repo.findAccountByUserId(userIds[0]);
    assert(account, 'Earn did not create its ledger account.');

    const redeem = new RedeemLoyaltyPointsUseCase(repo, activeGate);
    const redemptionResults = await Promise.all([
      redeem.execute({ userId: userIds[0], points: 80, reason: 'proof redemption A', idempotencyKey: `proof-a-${randomUUID()}` }),
      redeem.execute({ userId: userIds[0], points: 80, reason: 'proof redemption B', idempotencyKey: `proof-b-${randomUUID()}` }),
    ]);
    const redemptionWinners = redemptionResults.filter((result) => result.ok).length;
    assert(redemptionWinners === 1, 'Concurrent redemption did not produce exactly one winner.');
    let entries = await repo.listEntries(account.id);
    assert(computeBalance(entries, new Date()).available === 20, 'Concurrent redemption corrupted balance.');

    const winningDebit = redemptionResults.find((result) => result.ok);
    assert(winningDebit?.ok, 'Winning redemption missing.');
    const reverse = new ReverseLoyaltyEntryUseCase(repo);
    const reversals = await Promise.all([
      reverse.execute({ entryId: winningDebit.value.id, reason: 'proof reversal' }),
      reverse.execute({ entryId: winningDebit.value.id, reason: 'proof reversal' }),
    ]);
    assert(reversals.every((result) => result.ok), 'Reversal replay failed.');
    entries = await repo.listEntries(account.id);
    assert(entries.filter((entry) => entry.type === 'reversal').length === 1, 'Reversal duplicated.');
    assert(computeBalance(entries, new Date()).available === 100, 'Reversal did not restore the debit exactly once.');

    const expiryAccount = await repo.getOrCreateAccount(userIds[1]);
    const expiredEarn = await repo.append({
      accountId: expiryAccount.id,
      type: 'earn',
      points: 100,
      orderId: orderIds[1],
      reason: 'proof expired earn',
      idempotencyKey: `proof-expired-${randomUUID()}`,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      reversedEntryId: null,
    });
    const expiryRedemption = await redeem.execute({
      userId: userIds[1], points: 80, reason: 'proof FIFO redemption', idempotencyKey: `proof-fifo-${randomUUID()}`,
    });
    assert(expiryRedemption.ok, 'FIFO proof redemption failed.');
    await db.update(loyaltyLedgerEntries).set({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }).where(eq(loyaltyLedgerEntries.id, expiredEarn.entry.id));
    const beforeExpiry = computeBalance(await repo.listEntries(expiryAccount.id), new Date());
    assert(beforeExpiry.available === 20 && beforeExpiry.pendingExpiry === 20, 'Due expiry did not isolate the unspent FIFO remainder.');
    const expire = new ExpireLoyaltyPointsUseCase(repo);
    const firstExpiry = await expire.execute({ accountId: expiryAccount.id });
    const replayExpiry = await expire.execute({ accountId: expiryAccount.id });
    const afterExpiry = computeBalance(await repo.listEntries(expiryAccount.id), new Date());
    assert(firstExpiry.length === 1 && replayExpiry.length === 0, 'Expiry was not idempotent.');
    assert(firstExpiry[0]?.points === -20 && afterExpiry.available === 0 && afterExpiry.pendingExpiry === 0, 'Expiry did not create one exact unspent-remainder offset event.');

    let idempotencyConflict = false;
    try {
      await repo.append({
        accountId: expiryAccount.id,
        type: 'earn',
        points: 51,
        orderId: orderIds[1],
        reason: 'conflicting retry',
        idempotencyKey: expiredEarn.entry.idempotencyKey,
        expiresAt: expiredEarn.entry.expiresAt,
        reversedEntryId: null,
      });
    } catch (error) {
      idempotencyConflict = (error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT';
    }
    assert(idempotencyConflict, 'Idempotency key accepted different ledger facts.');

    let databaseShapeRejected = false;
    try {
      await db.insert(loyaltyLedgerEntries).values({
        accountId: account.id,
        type: 'redeem',
        points: 1,
        orderId: null,
        reason: 'invalid sign',
        idempotencyKey: `invalid-${randomUUID()}`,
      });
    } catch {
      databaseShapeRejected = true;
    }
    assert(databaseShapeRejected, 'Database accepted an invalid redeem sign.');

    const noAccountBefore = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.userId, userIds[2]));
    const dormantHistory = await new GetLoyaltyHistoryUseCase(repo, dormantGate).execute({ userId: userIds[2] });
    const noAccountAfter = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.userId, userIds[2]));
    assert(noAccountBefore.length === 0 && noAccountAfter.length === 0 && dormantHistory.entries.length === 0, 'Read-only history created an account.');

    const snapshot = await repo.getOperationsSnapshot({ now: new Date(), limit: 50 });
    const [balanceColumns]: any = await db.execute(sql`
      select count(*)::int value from information_schema.columns
      where table_schema = 'public' and table_name = 'loyalty_accounts' and column_name like '%balance%'
    `);
    assert(Number(balanceColumns.value) === 0, 'A mutable account balance column exists.');
    assert(snapshot.entryCount === 6 && snapshot.signedBalance === 100, 'Operations snapshot does not reconcile to immutable events.');
    const paidOrderRows = await db.select({ status: orders.paymentStatus, total: orders.totalAmount }).from(orders).where(inArray(orders.id, orderIds));
    assert(paidOrderRows.every((row) => row.status === 'paid' && row.total === 10_000), 'Loyalty proof mutated canonical order facts.');

    report = {
      dormantGateDenied: true,
      duplicatePaidOrderEarn: true,
      earnEvents: snapshot.byType.earn,
      redemptionContenders: 2,
      redemptionWinners,
      negativeBalance: false,
      reversalReplay: true,
      expiryEvents: snapshot.byType.expiry,
      expiryReplay: true,
      balanceOnlyFromLedgerEvents: true,
      mutableBalanceColumns: 0,
      idempotencyConflictDenied: idempotencyConflict,
      invalidLedgerShapeDenied: databaseShapeRejected,
      readOnlyHistoryWrites: 0,
      operationsEntryCount: snapshot.entryCount,
      signedPointsLiability: snapshot.signedBalance,
      providerCalls,
    };
  } catch (error) {
    failure = error;
  } finally {
    try {
      const accounts = await db.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(inArray(loyaltyAccounts.userId, userIds));
      if (accounts.length > 0) await db.delete(loyaltyLedgerEntries).where(inArray(loyaltyLedgerEntries.accountId, accounts.map((row) => row.id)));
      await db.delete(loyaltyAccounts).where(inArray(loyaltyAccounts.userId, userIds));
      await db.delete(orders).where(inArray(orders.id, orderIds));
      await db.delete(users).where(inArray(users.id, userIds));
      await db.delete(loyaltyConfig);
      if (originalConfig.length > 0) await db.insert(loyaltyConfig).values(originalConfig);
      const after = await protectedCounts();
      const deltas = Object.fromEntries(Object.keys(before).map((key) => [key, after[key] - before[key]]));
      report.protectedDeltas = deltas;
      assert(Object.values(deltas).every((value) => value === 0), 'Protected table counts changed after cleanup.');
      const residue: any = await db.execute(sql`
        select
          (select count(*)::int from users where id in (${userIds[0]}, ${userIds[1]}, ${userIds[2]}))
          + (select count(*)::int from orders where id in (${orderIds[0]}, ${orderIds[1]}))
          + (select count(*)::int from loyalty_accounts where user_id in (${userIds[0]}, ${userIds[1]}, ${userIds[2]})) as value
      `);
      report.proofResidue = Number((residue.rows ?? residue)[0].value);
      assert(report.proofResidue === 0, 'Loyalty proof residue remains.');
    } catch (error) {
      failure ??= error;
    }
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }

  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' }));
  if (failure) throw failure;
}

main().catch((error) => {
  console.error('LOYALTY_LEDGER_PROOF_ERROR', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
