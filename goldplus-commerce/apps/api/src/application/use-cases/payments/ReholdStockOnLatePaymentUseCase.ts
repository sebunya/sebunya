import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { appLogger } from '../../logging/appLogger';

export interface LatePaymentStockPort {
  summariseReservations(orderId: string): Promise<{ total: number; reserved: number; consumed: number; released: number }>;
  reacquireReleasedForOrder(orderId: string): Promise<{ ok: true; lines: number } | { ok: false; short: Array<{ productId: string; wanted: number; available: number }> }>;
}

/**
 * A payment that lands after the order's stock hold expired (reservation_ttl
 * _hours released it). The customer can pay a failed attempt again on the same
 * page, so this happens. Before 2026-10-07 the order simply went to processing
 * holding nothing: dispatch found no reservation, stock never went down, and
 * the units may already have been sold to someone else.
 *
 * Now: the released holds are taken again, all or nothing. When the stock is
 * gone, the order is NOT blocked (the money is in); it is flagged loudly for a
 * person to arrange stock or a refund.
 */
export class ReholdStockOnLatePaymentUseCase {
  constructor(private readonly stock: LatePaymentStockPort, private readonly audit: IAuditRepository) {}

  async execute(orderId: string): Promise<'NOT_NEEDED' | 'REHELD' | 'STOCK_SHORT'> {
    const s = await this.stock.summariseReservations(orderId);
    if (s.released === 0 || s.reserved > 0 || s.consumed > 0) return 'NOT_NEEDED';
    const result = await this.stock.reacquireReleasedForOrder(orderId);
    const auditor = new CreateAuditLogUseCase(this.audit);
    if (result.ok) {
      await auditor.execute({ actorId: null, action: 'RESERVATION_REACQUIRED', entity: 'order', entityId: orderId,
        previousState: { reservation: 'released' }, newState: { reservation: 'reserved', reason: 'Paid after the stock hold expired; stock held again.', lines: result.lines } });
      return 'REHELD';
    }
    await auditor.execute({ actorId: null, action: 'PAID_ORDER_STOCK_SHORT', entity: 'order', entityId: orderId,
      previousState: { reservation: 'released' }, newState: { short: result.short, reason: 'Paid after the stock hold expired, and the stock has since gone. Arrange stock or refund.' } });
    appLogger.error({ orderId, short: result.short, kind: 'PAID_ORDER_STOCK_SHORT' },
      'ALERT PAID_ORDER_STOCK_SHORT — an order was paid after its stock hold expired and the stock is no longer there: arrange stock or refund');
    return 'STOCK_SHORT';
  }
}
