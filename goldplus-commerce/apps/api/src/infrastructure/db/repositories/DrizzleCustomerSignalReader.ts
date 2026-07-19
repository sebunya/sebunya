import { db } from '../client';
import { orders, carts } from '../schema/commerce';
import { fulfilmentDeliveries, fulfilmentTasks, fulfilmentLines } from '../schema/fulfilment';
import { loyaltyAccounts, loyaltyLedgerEntries } from '../schema/loyalty';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { RawCustomerSignals } from '../../../domain/customer-dna/CustomerFeatures';
import { IdentitySignalType } from '../../../domain/customer-dna/CustomerIdentity';
import { ICustomerSignalReader } from '../../../application/ports/ICustomerDnaRepository';

/**
 * Reads raw first-party signals for a customer from authoritative source systems
 * (orders, fulfilment deliveries/lines, carts, loyalty). It never invents data:
 * absent inputs simply produce empty collections that the pure feature computer
 * turns into NOT_OBSERVED. sourceVersion is a monotonic function of the newest
 * observed timestamp so projection idempotency holds.
 */
export class DrizzleCustomerSignalReader implements ICustomerSignalReader {
  async readSignals(input: { accountUserId: string | null; identifierKeys: string[] }): Promise<RawCustomerSignals> {
    const anon = input.identifierKeys.filter(Boolean);
    const matchers = [] as any[];
    if (input.accountUserId) matchers.push(eq(orders.userId, input.accountUserId));
    if (anon.length > 0) matchers.push(inArray(orders.anonymousId, anon));
    if (matchers.length === 0) {
      return { sourceVersion: 0, orders: [], searches: [], deliveries: [], backorderCount: 0, supportInteractions: 0, cartAbandonments: 0, loyaltyBalance: null, declaredPreferences: null };
    }
    const orderRows = await db.select().from(orders).where(or(...matchers));
    const orderIds = orderRows.map((o) => o.id);

    let deliveryRows: { outcome: string; createdAt: Date }[] = [];
    let backorderCount = 0;
    if (orderIds.length > 0) {
      deliveryRows = (await db.select({ outcome: fulfilmentDeliveries.outcome, createdAt: fulfilmentDeliveries.createdAt })
        .from(fulfilmentDeliveries).where(inArray(fulfilmentDeliveries.orderId, orderIds)))
        .map((d) => ({ outcome: d.outcome, createdAt: d.createdAt }));
      const [bo] = await db.select({ n: sql<number>`count(distinct ${fulfilmentLines.fulfilmentTaskId})::int` })
        .from(fulfilmentLines)
        .innerJoin(fulfilmentTasks, eq(fulfilmentLines.fulfilmentTaskId, fulfilmentTasks.id))
        .where(and(inArray(fulfilmentTasks.orderId, orderIds), sql`${fulfilmentLines.backorderedQuantity} > 0`));
      backorderCount = bo?.n ?? 0;
    }

    // Cart abandonments — carts for this customer that never converted to an order.
    const cartMatchers = [] as any[];
    if (input.accountUserId) cartMatchers.push(eq(carts.userId, input.accountUserId));
    if (anon.length > 0) cartMatchers.push(inArray(carts.anonymousId, anon));
    let cartAbandonments = 0;
    if (cartMatchers.length > 0) {
      const convertedCartIds = orderRows.map((o) => o.cartId).filter((id): id is string => !!id);
      const notConverted = convertedCartIds.length > 0
        ? and(or(...cartMatchers), sql`${carts.id} not in (${sql.join(convertedCartIds.map((id) => sql`${id}`), sql`, `)})`)
        : or(...cartMatchers);
      const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(carts).where(notConverted);
      cartAbandonments = c?.n ?? 0;
    }

    // Loyalty balance — sum of ledger points for the account (null if no account).
    let loyaltyBalance: number | null = null;
    if (input.accountUserId) {
      const [acct] = await db.select({ id: loyaltyAccounts.id }).from(loyaltyAccounts).where(eq(loyaltyAccounts.userId, input.accountUserId)).limit(1);
      if (acct) {
        const [bal] = await db.select({ pts: sql<number>`coalesce(sum(${loyaltyLedgerEntries.points}), 0)::int` })
          .from(loyaltyLedgerEntries).where(eq(loyaltyLedgerEntries.accountId, acct.id));
        loyaltyBalance = bal?.pts ?? 0;
      }
    }

    const stamps = [
      ...orderRows.map((o) => o.updatedAt?.getTime() ?? o.createdAt.getTime()),
      ...deliveryRows.map((d) => d.createdAt.getTime()),
    ];
    const sourceVersion = stamps.length ? Math.floor(Math.max(...stamps) / 1000) : 0;

    return {
      sourceVersion,
      orders: orderRows.map((o) => ({ totalAmountUgx: o.totalAmount, createdAt: o.createdAt, paymentMethod: null, status: o.status })),
      searches: [],
      deliveries: deliveryRows,
      backorderCount,
      supportInteractions: 0,
      cartAbandonments,
      loyaltyBalance,
      declaredPreferences: null,
    };
  }

  async listOrderIdentitySignals(limit: number, offset: number): Promise<{ signalType: IdentitySignalType; identifierKey: string; accountUserId: string | null; firstSeen: Date; lastSeen: Date }[]> {
    // Distinct account and anonymous identity signals derived from real orders.
    const accountRows = await db.select({
      userId: orders.userId,
      firstSeen: sql<Date>`min(${orders.createdAt})`,
      lastSeen: sql<Date>`max(${orders.createdAt})`,
    }).from(orders).where(sql`${orders.userId} is not null`).groupBy(orders.userId).limit(limit).offset(offset);

    const anonRows = await db.select({
      anon: orders.anonymousId,
      firstSeen: sql<Date>`min(${orders.createdAt})`,
      lastSeen: sql<Date>`max(${orders.createdAt})`,
    }).from(orders).where(sql`${orders.userId} is null and ${orders.anonymousId} is not null`).groupBy(orders.anonymousId).limit(limit).offset(offset);

    return [
      ...accountRows.filter((r) => r.userId).map((r) => ({ signalType: 'AUTHENTICATED_CUSTOMER_ID' as IdentitySignalType, identifierKey: r.userId as string, accountUserId: r.userId as string, firstSeen: r.firstSeen, lastSeen: r.lastSeen })),
      ...anonRows.filter((r) => r.anon).map((r) => ({ signalType: 'STABLE_ANONYMOUS_ID' as IdentitySignalType, identifierKey: r.anon as string, accountUserId: null, firstSeen: r.firstSeen, lastSeen: r.lastSeen })),
    ];
  }
}
