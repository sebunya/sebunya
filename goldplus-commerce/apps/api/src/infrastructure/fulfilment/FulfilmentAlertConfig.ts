import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { outboxEvents } from '../db/schema';
import { alertRecipients, validateFulfilmentAlertValue } from '../../domain/fulfilment/FulfilmentAlertConfig';
import { deliveryMapUrl } from '../../domain/fulfilment/PaidOrderAlert';
import type { IOrderRepository } from '../../application/use-cases/commerce/CheckoutUseCase';
import type { CreateAuditLogUseCase } from '../../application/use-cases/audit/CreateAuditLogUseCase';
import { storefrontOrigin } from '../config/storefrontOrigin';

/** What the alert settings reach for. The Registry passes itself, so each is read when a call is made. */
export interface FulfilmentAlertConfigPorts {
  readonly createAuditLogUseCase: Pick<CreateAuditLogUseCase, 'execute'>;
  readonly orderRepo: Pick<IOrderRepository, 'findById'>;
}

/**
 * Fulfilment alerts (0143). Who is told, on a phone, that an order is paid.
 * Closed registry, validated in the domain, audited on every change.
 *
 * Moved out of the Registry, 2026-11: the queries, the audit entry and the
 * outbox payload are exactly those the Registry held.
 */
export class FulfilmentAlertConfig {
  constructor(private readonly ports: FulfilmentAlertConfigPorts) {}

  async values(): Promise<Record<string, string>> {
    const rows = (await db.execute(sql`select config_key, config_value from fulfilment_alert_config`)) as unknown as Array<{
      config_key: string; config_value: string;
    }>;
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: typeof rows }).rows ?? []);
    return Object.fromEntries(list.map((r) => [r.config_key, r.config_value]));
  }

  async set(input: { key: string; value: string; actorId: string | null }) {
    const check = validateFulfilmentAlertValue(input.key, input.value);
    if (!check.ok) return { ok: false as const, message: check.message };
    const before = await this.values();
    await db.execute(sql`
      insert into fulfilment_alert_config (config_key, config_value, updated_by, updated_at)
      values (${input.key}, ${check.value}, ${input.actorId}, now())
      on conflict (config_key) do update set config_value = excluded.config_value,
        updated_by = excluded.updated_by, updated_at = now()`);
    await this.ports.createAuditLogUseCase.execute({
      actorId: input.actorId,
      action: 'FULFILMENT_ALERT_CONFIG_SET',
      entity: 'fulfilment_alert_config',
      entityId: input.key,
      previousState: { value: before[input.key] ?? null },
      newState: { value: check.value },
    } as never);
    return { ok: true as const };
  }

  /** Queues the paid-order alert. Returns why nothing was queued, never silently. */
  async enqueuePaidOrderAlert(orderId: string, opts?: { test?: boolean }): Promise<{ queued: boolean; reason: string }> {
    const values = await this.values();
    const recipients = alertRecipients(values);
    if (!recipients.length) return { queued: false, reason: 'NO_RECIPIENT_OR_DISABLED' };
    const order = await this.ports.orderRepo.findById(orderId);
    if (!order) return { queued: false, reason: 'ORDER_NOT_FOUND' };
    // One event per person, each with its own idempotency key: a failure to
    // reach one phone must not stop the others, and a retry must not send the
    // same person the same order twice.
    const stamp = opts?.test ? Date.now() : 0;
    for (const recipient of recipients) {
    await db.insert(outboxEvents).values({
      eventType: 'FULFILMENT_PAID_ORDER_ALERT',
      payload: {
        recipient,
        orderNumber: order.orderNumber,
        totalUgx: order.totalUgx,
        deliveryArea: order.deliveryArea ?? '',
        // 2026-10-21: what to pack, where it goes and who to call, so the text can be acted on as it is read.
        // Customer fields use the names an erasure removes (customerName, customerPhone, deliveryPlace).
        deliveryFeeUgx: order.deliveryFeeUgx,
        items: order.items.map((it) => ({ name: it.name, sku: it.sku, quantity: it.quantity })),
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        deliveryPlace: order.deliveryAddress ?? '',
        placeLabel: (order.deliveryLocation as { displayLabel?: string } | null)?.displayLabel ?? null,
        mapUrl: deliveryMapUrl(order.deliveryLocation),
        storeCreditUgx: order.storeCreditAppliedUgx ?? 0,
        orderUrl: `${storefrontOrigin() ?? 'https://shopgoldplus.com'}/admin/orders/${order.id}`,
        test: opts?.test === true,
      } as never,
      idempotencyKey: opts?.test
        ? `fulfilment-alert-test:${orderId}:${recipient}:${stamp}`
        : `fulfilment-alert:${orderId}:${recipient}`,
      status: 'pending',
      channel: 'sms',
      template: 'FULFILMENT_PAID_ORDER_ALERT',
      relatedEntity: 'order',
      relatedEntityId: orderId,
    } as never).onConflictDoNothing({ target: outboxEvents.idempotencyKey });
    }
    return { queued: true, reason: `QUEUED_FOR_${recipients.length}` };
  }
}
