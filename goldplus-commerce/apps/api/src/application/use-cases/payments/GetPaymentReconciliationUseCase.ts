import { reconcilePayments, ReconciliationReport } from '../../../domain/payments/PaymentReconciliation';
import { IPaymentRepository } from '../../ports/IPaymentRepository';
import { IPesaPalPaymentRepository } from '../../ports/IPesaPalPaymentRepository';
import { IOrderRepository } from '../commerce/CheckoutUseCase';
import { Order } from '../../../domain/commerce/Order';

interface IOrderListRepository extends IOrderRepository {
  findAll(): Promise<Order[]>;
}

const ATTEMPT_SAMPLE = 500;

/**
 * Slice 3C: read-only cross-check of order payment status vs recorded
 * webhook payments vs provider attempts. Never mutates anything.
 */
export class GetPaymentReconciliationUseCase {
  constructor(
    private readonly orders: IOrderListRepository,
    private readonly payments: IPaymentRepository,
    private readonly attempts: IPesaPalPaymentRepository
  ) {}

  async execute(): Promise<ReconciliationReport> {
    const [orders, payments, attempts] = await Promise.all([
      this.orders.findAll(),
      this.payments.findAll(),
      this.attempts.listRecent(ATTEMPT_SAMPLE),
    ]);

    return reconcilePayments({
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        paymentStatus: o.paymentStatus,
        totalUgx: o.totalUgx,
      })),
      payments: payments.map((p) => ({
        orderId: p.orderId,
        status: p.status,
        amount: p.amount,
        paidAt: p.paidAt,
      })),
      attempts: attempts.map((a) => ({
        orderId: a.orderId,
        merchantReference: a.merchantReference,
        status: a.status,
        amount: a.amount,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
      now: new Date(),
    });
  }
}
