import type { Order } from '../../../domain/commerce/Order';
import type { CheckoutSideEffectType } from '../../ports/ICheckoutSideEffectRecorder';
import type { IPesaPalPaymentRepository } from '../../ports/IPesaPalPaymentRepository';
import { confirmationForPlacedOrder } from '../../notifications/OrderLifecycleMessages';
import type { CreateFulfilmentTaskOnOrderPlacedUseCase } from '../fulfilment/CreateFulfilmentTaskOnOrderPlacedUseCase';
import type { EnqueueAdminOrderEmailUseCase } from '../notifications/EnqueueAdminOrderEmailUseCase';
import type { SettlePaymentUseCase } from '../payments/SettlePaymentUseCase';
import type { EnqueueCustomerOrderMessage } from '../orders/ApplyOrderTransitionEffectsUseCase';
import type { CheckoutSideEffectHandler } from './ProcessCheckoutSideEffectBatchUseCase';

/**
 * Payment-attempt statuses the provider has already given a final answer for.
 *
 * `pending` and `verification_pending` are the only ones still worth asking
 * about. Everything here is settled — and time never moves an attempt into this
 * set on its own, only the provider's own answer does.
 */
export const TERMINAL_PAYMENT_ATTEMPT_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'invalid',
  'reversed',
  'cancelled',
  'abandoned',
  'verification_failed',
]);

/**
 * What the checkout side-effect handlers reach for. The names are the
 * composition root's own member names, and the composition root passes ITSELF:
 * every dependency is read when an event is handled, not when the handlers are
 * built, exactly as when these handlers lived inside the Registry
 * (`settlePaymentUseCase` is constructed after the batch use case that holds them).
 */
export interface CheckoutSideEffectHandlerPorts {
  readonly orderRepo: {
    findById(id: string): Promise<Order | null>;
    /** How the customer chose to pay ('pesapal' | 'offline'), or null for a legacy/admin order. */
    findPaymentMethod(id: string): Promise<string | null>;
  };
  readonly createFulfilmentTaskOnOrderPlacedUseCase: Pick<CreateFulfilmentTaskOnOrderPlacedUseCase, 'execute'>;
  readonly enqueueAdminOrderEmailUseCase: Pick<EnqueueAdminOrderEmailUseCase, 'execute'>;
  readonly pesapalPaymentRepo: Pick<IPesaPalPaymentRepository, 'findAttemptsByOrderId'>;
  readonly settlePaymentUseCase: Pick<SettlePaymentUseCase, 'execute'>;
}

/**
 * The handlers ProcessCheckoutSideEffectBatchUseCase runs for the commerce work
 * checkout queues durably: one per event type (moved out of the Registry,
 * 2026-11; the bodies are exactly those the Registry registered).
 *
 * Each handler must tolerate being called again: the outbox guarantees
 * at-least-once (see the Registry's note on processCheckoutSideEffectBatchUseCase).
 * Event types with no handler here are covered by TERMINAL_SIDE_EFFECT_POLICY.
 */
export function buildCheckoutSideEffectHandlers(
  ports: CheckoutSideEffectHandlerPorts,
  enqueueCustomerOrderMessage: EnqueueCustomerOrderMessage,
): Partial<Record<CheckoutSideEffectType, CheckoutSideEffectHandler>> {
  return {
    ORDER_FULFILMENT_REQUIRED: {
      handle: async (event) => {
        const order = await ports.orderRepo.findById(event.orderId);
        // A queued event naming an order that does not exist cannot be fixed
        // by waiting.
        if (!order) return { status: 'FINAL', error: 'ORDER_NOT_FOUND' };
        await ports.createFulfilmentTaskOnOrderPlacedUseCase.execute(order, {
          extraWarnings: Array.isArray(event.payload.warnings)
            ? (event.payload.warnings as string[])
            : [],
          hold: event.payload.hold === true,
          paymentMethod: await ports.orderRepo.findPaymentMethod(order.id),
        });
        return { status: 'HANDLED' };
      },
    },
    ORDER_ADMIN_NOTIFICATION_REQUIRED: {
      handle: async (event) => {
        const order = await ports.orderRepo.findById(event.orderId);
        if (!order) return { status: 'FINAL', error: 'ORDER_NOT_FOUND' };
        await ports.enqueueAdminOrderEmailUseCase.execute({
          order,
          event: 'placed',
          stockConfirmed: event.payload.stockConfirmed === true,
        });
        // The customer's own copy of a pay-on-delivery order: its reference
        // is what /track-order needs. Online payers are told when the money
        // lands (ORDER_PAYMENT_SUCCESS). Once per order (outbox key).
        const confirmation = confirmationForPlacedOrder(await ports.orderRepo.findPaymentMethod(order.id));
        if (confirmation) await enqueueCustomerOrderMessage(order.id, confirmation);
        return { status: 'HANDLED' };
      },
    },
    /**
     * The safety net, finally hung up.
     *
     * `StartOrderPaymentUseCase` has always recorded this event for the case
     * the callback design cannot cover — the customer who pays and never
     * comes back. Nothing consumed it, so two real events sat pending for ten
     * days at 339 and 279 attempts.
     *
     * It delegates. `SettlePaymentUseCase` is THE settlement path, shared with
     * the IPN, the browser callback and the reconciliation poller, so this
     * handler adds a fourth door onto the same room rather than a second
     * payment engine. Consequences that matter here:
     *
     *   - It VERIFIES, never charges. There is no code path from here that
     *     creates a provider transaction or moves money.
     *   - Only the provider's own answer is written. This handler cannot
     *     express "assume paid".
     *   - Replay is safe by construction: settlement advances the stage with a
     *     compare-and-set against SETTLEABLE_STAGES, so a second delivery of
     *     the same event finds the stage already advanced and performs no
     *     effect at all.
     */
    ORDER_PAYMENT_VERIFICATION_REQUIRED: {
      handle: async (event) => {
        const attempts = await ports.pesapalPaymentRepo.findAttemptsByOrderId(event.orderId);
        if (attempts.length === 0) {
          // No attempt row means payment never started. No amount of waiting
          // creates one, and there is nothing to ask the provider about.
          return { status: 'FINAL', error: 'NO_PAYMENT_ATTEMPT_FOR_ORDER' };
        }

        // Only attempts the provider actually knows about can be verified. An
        // attempt with no tracking id means SubmitOrderRequest never succeeded:
        // no payment page existed, so no money is possible by construction.
        const askable = attempts.filter((attempt) => attempt.orderTrackingId);
        if (askable.length === 0) {
          return { status: 'FINAL', error: 'NO_PROVIDER_TRANSACTION_TO_VERIFY' };
        }

        // An attempt the provider has already answered needs no second
        // question. Both production events were like this: the provider said
        // `invalid` days ago and the order has sat at payment_status=failed
        // ever since. Re-asking would change nothing, and a verification call
        // against a long-dead transaction is a way to get a surprising answer
        // about a settled matter.
        const unresolved = askable.filter(
          (attempt) => !TERMINAL_PAYMENT_ATTEMPT_STATUSES.has(attempt.status),
        );
        if (unresolved.length === 0) {
          return { status: 'HANDLED' };
        }

        for (const attempt of unresolved) {
          await ports.settlePaymentUseCase.execute({
            orderTrackingId: attempt.orderTrackingId as string,
            merchantReference: attempt.merchantReference,
            source: 'poll',
            traceId: `outbox:${event.id}`,
          });
        }

        // HANDLED means "we asked and recorded the answer", not "the payment
        // succeeded". A payment still pending at the provider is a truthful
        // outcome for this event; the reconciliation ticker keeps asking.
        return { status: 'HANDLED' };
      },
    },
  };
}
