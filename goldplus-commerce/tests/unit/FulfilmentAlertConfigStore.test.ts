import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { FulfilmentAlertConfig } from '../../apps/api/src/infrastructure/fulfilment/FulfilmentAlertConfig';
import { outboxEvents } from '../../apps/api/src/infrastructure/db/schema';

/**
 * Who is told, on a phone, that an order is paid (0143; moved out of the
 * Registry, 2026-11). Checked on the SQL sent, the audit row written, and the
 * outbox rows queued: one per person, each with its own idempotency key.
 */

const { execute, inserted, origin } = vi.hoisted(() => ({
  execute: vi.fn(async (_query: unknown): Promise<unknown> => []),
  inserted: [] as Array<{ table: unknown; row: Record<string, unknown>; conflict: unknown }>,
  origin: vi.fn((): string | null => 'https://shopgoldplus.com'),
}));
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({
  db: {
    execute: (q: unknown) => execute(q),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: async (conflict: unknown) => { inserted.push({ table, row, conflict }); },
      }),
    }),
  },
}));
vi.mock('../../apps/api/src/infrastructure/config/storefrontOrigin', () => ({ storefrontOrigin: () => origin() }));

const dialect = new PgDialect();
const render = (q: unknown) => {
  const query = dialect.sqlToQuery(q as SQL);
  return { text: query.sql.replace(/\s+/g, ' ').trim(), params: query.params };
};

const audit = vi.fn(async (_input: unknown) => ({}));
const findById = vi.fn(async (_id: string): Promise<unknown> => null);
const config = new FulfilmentAlertConfig({ createAuditLogUseCase: { execute: audit } as never, orderRepo: { findById } as never });

const configRows = (values: Record<string, string>) => Object.entries(values).map(([config_key, config_value]) => ({ config_key, config_value }));
const ON = { paid_order_sms_enabled: 'true', paid_order_sms_recipient: '+256776004545,+256701234567' };

const order = {
  id: 'ord-1',
  orderNumber: 'GP-10293',
  totalUgx: 185000,
  deliveryArea: 'Ntinda',
  deliveryFeeUgx: 7000,
  items: [{ name: '18k chain', sku: 'CH-18-45', quantity: 1, unitPriceUgx: 178000 }],
  customerName: 'Amina N.',
  customerPhone: '+256772000111',
  deliveryAddress: 'Plot 4, Ntinda Road',
  deliveryLocation: { displayLabel: 'Ntinda Shopping Complex', gpsLat: 0.3536, gpsLng: 32.6146 },
  storeCreditAppliedUgx: 20000,
};

beforeEach(() => {
  execute.mockReset().mockResolvedValue([]);
  inserted.length = 0;
  origin.mockReset().mockReturnValue('https://shopgoldplus.com');
  audit.mockClear();
  findById.mockReset().mockResolvedValue(null);
});

describe('values', () => {
  it('reads every setting as a key-value map', async () => {
    execute.mockResolvedValueOnce(configRows(ON));
    await expect(config.values()).resolves.toEqual(ON);
    expect(render(execute.mock.calls[0][0])).toEqual({ text: 'select config_key, config_value from fulfilment_alert_config', params: [] });
  });

  it('accepts a driver result that carries its rows on .rows', async () => {
    execute.mockResolvedValueOnce({ rows: configRows({ paid_order_sms_enabled: 'false' }) });
    await expect(config.values()).resolves.toEqual({ paid_order_sms_enabled: 'false' });
  });
});

describe('set', () => {
  it('refuses a value the domain rejects, writing and auditing nothing', async () => {
    await expect(config.set({ key: 'paid_order_sms_recipient', value: '12345', actorId: 'admin-1' })).resolves.toEqual({
      ok: false,
      message: '"12345" is not a Ugandan mobile number. Use a form like 0776004545 or +256776004545.',
    });
    await expect(config.set({ key: 'sms_provider', value: 'x', actorId: 'admin-1' })).resolves.toMatchObject({ ok: false });
    expect(execute).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('upserts the normalised value and audits the change from what was there', async () => {
    execute.mockResolvedValueOnce(configRows({ paid_order_sms_recipient: '+256776004545' }));
    await expect(config.set({ key: 'paid_order_sms_recipient', value: '0776 004545, 0701234567', actorId: 'admin-1' })).resolves.toEqual({ ok: true });
    const write = render(execute.mock.calls[1][0]);
    expect(write.text).toBe(
      'insert into fulfilment_alert_config (config_key, config_value, updated_by, updated_at) values ($1, $2, $3, now()) on conflict (config_key) do update set config_value = excluded.config_value, updated_by = excluded.updated_by, updated_at = now()',
    );
    expect(write.params).toEqual(['paid_order_sms_recipient', '+256776004545,+256701234567', 'admin-1']);
    expect(audit).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'FULFILMENT_ALERT_CONFIG_SET',
      entity: 'fulfilment_alert_config',
      entityId: 'paid_order_sms_recipient',
      previousState: { value: '+256776004545' },
      newState: { value: '+256776004545,+256701234567' },
    });
  });

  it('audits a first write as coming from nothing', async () => {
    await config.set({ key: 'paid_order_sms_enabled', value: ' true ', actorId: null });
    expect(render(execute.mock.calls[1][0]).params).toEqual(['paid_order_sms_enabled', 'true', null]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: null, previousState: { value: null }, newState: { value: 'true' } }));
  });
});

describe('enqueuePaidOrderAlert', () => {
  it('queues nothing, and says so, while the switch is off or nobody is listed', async () => {
    execute.mockResolvedValueOnce(configRows({ paid_order_sms_recipient: '+256776004545' }));
    await expect(config.enqueuePaidOrderAlert('ord-1')).resolves.toEqual({ queued: false, reason: 'NO_RECIPIENT_OR_DISABLED' });
    execute.mockResolvedValueOnce(configRows({ paid_order_sms_enabled: 'true' }));
    await expect(config.enqueuePaidOrderAlert('ord-1')).resolves.toEqual({ queued: false, reason: 'NO_RECIPIENT_OR_DISABLED' });
    expect(findById).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it('says when the order is not there', async () => {
    execute.mockResolvedValueOnce(configRows(ON));
    await expect(config.enqueuePaidOrderAlert('ord-404')).resolves.toEqual({ queued: false, reason: 'ORDER_NOT_FOUND' });
    expect(findById).toHaveBeenCalledWith('ord-404');
    expect(inserted).toEqual([]);
  });

  it('queues one SMS per person, each idempotent on order and phone, carrying what to pack and where it goes', async () => {
    execute.mockResolvedValueOnce(configRows(ON));
    findById.mockResolvedValueOnce(order);
    await expect(config.enqueuePaidOrderAlert('ord-1')).resolves.toEqual({ queued: true, reason: 'QUEUED_FOR_2' });
    expect(inserted).toHaveLength(2);
    for (const i of inserted) {
      expect(i.table).toBe(outboxEvents);
      expect(i.conflict).toEqual({ target: outboxEvents.idempotencyKey });
    }
    expect(inserted.map((i) => i.row.idempotencyKey)).toEqual(['fulfilment-alert:ord-1:+256776004545', 'fulfilment-alert:ord-1:+256701234567']);
    expect(inserted[0].row).toEqual({
      eventType: 'FULFILMENT_PAID_ORDER_ALERT',
      payload: {
        recipient: '+256776004545',
        orderNumber: 'GP-10293',
        totalUgx: 185000,
        deliveryArea: 'Ntinda',
        deliveryFeeUgx: 7000,
        items: [{ name: '18k chain', sku: 'CH-18-45', quantity: 1 }],
        customerName: 'Amina N.',
        customerPhone: '+256772000111',
        deliveryPlace: 'Plot 4, Ntinda Road',
        placeLabel: 'Ntinda Shopping Complex',
        mapUrl: 'https://maps.google.com/?q=0.353600,32.614600',
        storeCreditUgx: 20000,
        orderUrl: 'https://shopgoldplus.com/admin/orders/ord-1',
        test: false,
      },
      idempotencyKey: 'fulfilment-alert:ord-1:+256776004545',
      status: 'pending',
      channel: 'sms',
      template: 'FULFILMENT_PAID_ORDER_ALERT',
      relatedEntity: 'order',
      relatedEntityId: 'ord-1',
    });
  });

  it('fills the gaps of a sparse order with empty answers, and falls back to the shop origin', async () => {
    origin.mockReturnValue(null);
    execute.mockResolvedValueOnce(configRows({ paid_order_sms_enabled: 'true', paid_order_sms_recipient: '+256776004545' }));
    findById.mockResolvedValueOnce({ ...order, deliveryArea: null, deliveryAddress: null, deliveryLocation: null, storeCreditAppliedUgx: null });
    await config.enqueuePaidOrderAlert('ord-1');
    expect(inserted[0].row.payload).toMatchObject({
      deliveryArea: '', deliveryPlace: '', placeLabel: null, mapUrl: null, storeCreditUgx: 0, orderUrl: 'https://shopgoldplus.com/admin/orders/ord-1',
    });
  });

  it('marks a test send and keys it by the moment, so a second test is not swallowed', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1762934400000);
    execute.mockResolvedValueOnce(configRows({ paid_order_sms_enabled: 'true', paid_order_sms_recipient: '+256776004545' }));
    findById.mockResolvedValueOnce(order);
    await expect(config.enqueuePaidOrderAlert('ord-1', { test: true })).resolves.toEqual({ queued: true, reason: 'QUEUED_FOR_1' });
    now.mockRestore();
    expect(inserted[0].row.idempotencyKey).toBe('fulfilment-alert-test:ord-1:+256776004545:1762934400000');
    expect(inserted[0].row.payload).toMatchObject({ test: true });
  });
});
