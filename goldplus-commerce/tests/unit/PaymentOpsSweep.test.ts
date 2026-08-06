import { describe, it, expect, beforeEach } from 'vitest';
import {
  AbandonStaleUnpaidOrdersUseCase,
  AlertOnLedgerMismatchUseCase,
  ExpireStaleReservationsUseCase,
} from '../../apps/api/src/application/use-cases/payments/PaymentOpsSweepUseCases';
import { validatePaymentsOpsValue, isPaymentsOpsConfigKey } from '../../apps/api/src/domain/payments/PaymentsOpsConfig';

/**
 * The payment ops sweep: reservation TTL, order abandonment, and the ledger
 * mismatch alert. Every mechanism ships OFF — the thresholds are business
 * decisions an operator makes, never developer defaults — and every test here
 * starts from the state production was found in: stock held for months by
 * unpaid test orders, and a mismatch report nobody read.
 */

const HOUR = 3_600_000;
const NOW = new Date('2026-08-06T12:00:00Z');

const audit = { entries: [] as any[], async save(e: any) { this.entries.push(e); return e; } };

class FakeOrders {
  stale: Array<{ id: string; orderNumber: string; status: string; createdAt: Date }> = [];
  reserved: Array<{ id: string; orderNumber: string; createdAt: Date }> = [];
  lastStaleCutoff: Date | null = null;
  lastReservedCutoff: Date | null = null;
  async listStaleUnpaidOrders(olderThan: Date) {
    this.lastStaleCutoff = olderThan;
    return this.stale.filter((o) => o.createdAt < olderThan);
  }
  async listReservedUnpaidOrders(olderThan: Date) {
    this.lastReservedCutoff = olderThan;
    return this.reserved.filter((o) => o.createdAt < olderThan);
  }
}

let orders: FakeOrders;
let releases: string[];
let transitions: Array<{ orderId: string; to: string; reasonCode: string }>;
let config: Record<string, string>;

const inventory = {
  async releaseForOrder(orderId: string) {
    releases.push(orderId);
    return { released: true };
  },
};

const configReader = { values: async () => config };

beforeEach(() => {
  orders = new FakeOrders();
  releases = [];
  transitions = [];
  config = {};
  audit.entries = [];
});

describe('reservation TTL — stock held by an unpaid order goes back on sale', () => {
  const useCase = () => new ExpireStaleReservationsUseCase(configReader, orders, inventory, audit as never);

  it('does NOTHING while the TTL is unset, and says why', async () => {
    orders.reserved = [{ id: 'o1', orderNumber: 'GP-1', createdAt: new Date(NOW.getTime() - 1000 * HOUR) }];
    const r = await useCase().execute(NOW);
    expect(r).toEqual({ released: 0, skipped: 'ttl_not_configured' });
    expect(releases).toEqual([]);
  });

  it('releases through the REAL transactional path once the TTL is set, and audits each', async () => {
    config.reservation_ttl_hours = '48';
    orders.reserved = [
      { id: 'old', orderNumber: 'GP-OLD', createdAt: new Date(NOW.getTime() - 72 * HOUR) },
      { id: 'new', orderNumber: 'GP-NEW', createdAt: new Date(NOW.getTime() - 2 * HOUR) },
    ];
    const r = await useCase().execute(NOW);
    expect(r.released).toBe(1);
    expect(releases).toEqual(['old']);
    expect(audit.entries[0]).toMatchObject({ action: 'RESERVATION_EXPIRED', entityId: 'old' });
    expect(audit.entries[0].newState.reason).toContain('48 hours');
  });

  it('the cutoff is the TTL, exactly', async () => {
    config.reservation_ttl_hours = '24';
    await useCase().execute(NOW);
    expect(orders.lastReservedCutoff).toEqual(new Date(NOW.getTime() - 24 * HOUR));
  });
});

describe('order abandonment — cancelled through the canonical lifecycle, never overwritten', () => {
  const transition = {
    async transition(orderId: string, to: 'cancelled', ctx: { reasonCode: string }) {
      transitions.push({ orderId, to, reasonCode: ctx.reasonCode });
    },
  };
  const useCase = () =>
    new AbandonStaleUnpaidOrdersUseCase(configReader, orders, transition, inventory, audit as never);

  it('does NOTHING while the window is unset', async () => {
    orders.stale = [{ id: 'o1', orderNumber: 'GP-1', status: 'received', createdAt: new Date(0) }];
    const r = await useCase().execute(NOW);
    expect(r).toMatchObject({ abandoned: 0, skipped: 'window_not_configured' });
    expect(transitions).toEqual([]);
  });

  it('cancels via the transition service with a named reason, then releases stock', async () => {
    config.order_abandonment_hours = '72';
    orders.stale = [{ id: 'o1', orderNumber: 'GP-1', status: 'received', createdAt: new Date(NOW.getTime() - 100 * HOUR) }];
    const r = await useCase().execute(NOW);
    expect(r.abandoned).toBe(1);
    expect(transitions).toEqual([{ orderId: 'o1', to: 'cancelled', reasonCode: 'payment_abandoned' }]);
    expect(releases).toEqual(['o1']);
    expect(audit.entries[0]).toMatchObject({ action: 'ORDER_ABANDONED_UNPAID' });
  });

  it('one refused transition never stops the rest', async () => {
    config.order_abandonment_hours = '72';
    const refusing = {
      async transition(orderId: string) {
        if (orderId === 'bad') throw new Error('ILLEGAL_TRANSITION');
        transitions.push({ orderId, to: 'cancelled', reasonCode: 'payment_abandoned' });
      },
    };
    orders.stale = [
      { id: 'bad', orderNumber: 'GP-BAD', status: 'received', createdAt: new Date(0) },
      { id: 'good', orderNumber: 'GP-GOOD', status: 'received', createdAt: new Date(0) },
    ];
    const r = await new AbandonStaleUnpaidOrdersUseCase(configReader, orders, refusing as never, inventory, audit as never).execute(NOW);
    expect(r.abandoned).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(transitions.map((t) => t.orderId)).toEqual(['good']);
  });

  /**
   * The exclusion that matters more than the rule. The reader contract only
   * returns orders with NO live attempt; an order whose attempt is still
   * `pending` may yet be answered COMPLETED by the provider, and cancelling it
   * would be exactly the "money taken, no order" failure the timeout rule
   * forbids. Pinned here as a contract scan so the SQL cannot quietly lose it.
   */
  it('the stale-order reader excludes orders with a live payment attempt', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const registry = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/Registry.ts'), 'utf8');
    const readerBlock = registry.slice(registry.indexOf('listStaleUnpaidOrders'), registry.indexOf('expireStaleReservationsUseCase'));
    expect(readerBlock).toContain('not exists');
    expect(readerBlock).toContain("'pending', 'verification_pending', 'verification_failed'");
  });
});

describe('RESERVED_LEDGER_MISMATCH is an alert, not a report line', () => {
  it('shouts when the scan finds a mismatch, with the entities named', async () => {
    const alerts: unknown[] = [];
    const useCase = new AlertOnLedgerMismatchUseCase(
      {
        async execute() {
          return {
            exceptions: [
              { type: 'RESERVED_LEDGER_MISMATCH', entityId: 'o1' },
              { type: 'ORDER_TOTAL_MISMATCH', entityId: 'o2' },
              { type: 'RESERVED_LEDGER_MISMATCH', entityId: 'o3' },
            ],
          };
        },
      },
      (input) => void alerts.push(input),
    );
    const r = await useCase.execute();
    expect(r.mismatches).toBe(2);
    expect(alerts).toEqual([{ count: 2, entityIds: ['o1', 'o3'] }]);
  });

  it('stays silent when there is nothing to shout about', async () => {
    const alerts: unknown[] = [];
    const useCase = new AlertOnLedgerMismatchUseCase(
      { async execute() { return { exceptions: [] }; } },
      (input) => void alerts.push(input),
    );
    await useCase.execute();
    expect(alerts).toEqual([]);
  });
});

describe('the ops config registry — closed, validated, no invented defaults', () => {
  it('refuses a key outside the registry', () => {
    expect(isPaymentsOpsConfigKey('some_new_knob')).toBe(false);
    expect(validatePaymentsOpsValue('some_new_knob', '5')).toMatchObject({ ok: false });
  });

  it('validates integers against their declared ranges', () => {
    expect(validatePaymentsOpsValue('reservation_ttl_hours', '48')).toEqual({ ok: true, value: 48 });
    expect(validatePaymentsOpsValue('reservation_ttl_hours', '0')).toMatchObject({ ok: false });
    expect(validatePaymentsOpsValue('reservation_ttl_hours', '48.5')).toMatchObject({ ok: false });
    expect(validatePaymentsOpsValue('reservation_ttl_hours', '10000')).toMatchObject({ ok: false });
  });

  it('validates clock values as real times of day', () => {
    expect(validatePaymentsOpsValue('trading_hours_start_eat', '08:30')).toEqual({ ok: true, value: '08:30' });
    expect(validatePaymentsOpsValue('trading_hours_start_eat', '25:99')).toMatchObject({ ok: false });
  });
});

/**
 * The order-level reservation state can no longer be entered and never left
 * (2026-08-06). Seven production orders claimed RESERVED after their stock was
 * released, because the 0053 vocabulary had no terminal — the payment-attempt
 * trap repeated on the exact field payment and fulfilment fail closed on.
 */
describe('orders.reservation_state has exits', () => {
  it('the vocabulary carries RELEASED and CONSUMED, and RELEASED may not progress to payment', async () => {
    const { mayProgressToPayment } = await import('../../apps/api/src/domain/inventory/Inventory');
    expect(mayProgressToPayment('RELEASED' as never)).toBe(false);
    expect(mayProgressToPayment('CONSUMED' as never)).toBe(false);
    expect(mayProgressToPayment('RESERVED' as never)).toBe(true);
  });

  it('releaseForOrder and consumeForOrder mirror the order row in the SAME transaction', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository.ts'),
      'utf8',
    );
    // Both mirrors run inside the ledger transaction via the shared helper —
    // extracted so the canonical-transition guard's inspection window around
    // .update(orders) contains only the two reservation fields.
    const releaseBlock = src.slice(src.indexOf('async releaseForOrder'), src.indexOf('async consumeForOrder'));
    expect(releaseBlock).toContain("mirrorOrderReservationState(tx, orderId, 'RELEASED')");
    const consumeBlock = src.slice(src.indexOf('async consumeForOrder'));
    expect(consumeBlock).toContain("mirrorOrderReservationState(tx, orderId, 'CONSUMED')");
    expect(src).toMatch(/private async mirrorOrderReservationState\(/);
    expect(src).toMatch(/reservationState: state, reservationUpdatedAt/);
  });

  it('the widened DB constraint admits exactly the domain vocabulary', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const migration = readFileSync(
      join(__dirname, '../../apps/api/src/infrastructure/db/migrations/0098_reservation_state_terminals.sql'),
      'utf8',
    );
    for (const state of ['PENDING', 'RESERVED', 'BACKORDERED', 'NOT_REQUIRED', 'UNRESERVED_BLOCKED', 'RELEASED', 'CONSUMED']) {
      expect(migration).toContain(`'${state}'`);
    }
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
  });
});
