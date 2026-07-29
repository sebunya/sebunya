import { Order } from '../../../domain/commerce/Order';
import {
  ReservationOutcome,
  ReservationOutcomeCode,
  OrderReservationState,
  isRetryableDatabaseError,
  summariseReservation,
} from '../../../domain/inventory/Inventory';
import { IInventoryRepository } from '../../ports/IInventoryRepository';

/**
 * Records the reservation state on the order, so payment and fulfilment can both
 * fail closed on a single authoritative value.
 */
export interface IOrderReservationStateWriter {
  setReservationState(orderId: string, state: OrderReservationState): Promise<void>;
}

/** Raised when reservation could not be established for a stock-controlled order. */
export interface ReservationAlert {
  orderId: string;
  code: ReservationOutcomeCode;
  attempts: number;
  detail: string;
}

export interface ReserveInventoryDeps {
  repo: IInventoryRepository;
  orderState?: IOrderReservationStateWriter | null;
  /** Called when reservation cannot be established. Never swallowed silently. */
  onAlert?: (alert: ReservationAlert) => void | Promise<void>;
}

/**
 * Reserves stock for a placed order and records what actually happened.
 *
 * This replaces a best-effort contract. Previously every error from the
 * repository — deadlock, statement timeout, dropped connection, or a genuine
 * bug — was caught by the caller and turned into an ON_HOLD backorder. A
 * technical failure and a real stock shortage became indistinguishable, the
 * order was recorded as backordered, and the same units stayed available to the
 * next customer.
 *
 * Now the outcome is explicit. A failure is reported as RETRYABLE_FAILURE or
 * TERMINAL_FAILURE and the order is recorded UNRESERVED_BLOCKED, which stops it
 * short of payment and fulfilment. Only a product whose policy permits it can
 * ever reach BACKORDERED.
 *
 * This never throws for a reservation failure: the order already exists, so
 * throwing would leave it in PENDING with nothing recorded. Compensation is to
 * record the blocked state and alert — the order is preserved, and it is
 * preserved *truthfully*.
 */
export class ReserveInventoryForOrderUseCase {
  private readonly repo: IInventoryRepository;
  private readonly orderState: IOrderReservationStateWriter | null;
  private readonly onAlert: ((alert: ReservationAlert) => void | Promise<void>) | undefined;

  constructor(deps: IInventoryRepository | ReserveInventoryDeps) {
    if ('repo' in deps) {
      this.repo = deps.repo;
      this.orderState = deps.orderState ?? null;
      this.onAlert = deps.onAlert;
    } else {
      this.repo = deps;
      this.orderState = null;
      this.onAlert = undefined;
    }
  }

  async execute(order: Order): Promise<ReservationOutcome> {
    const lines = order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));

    let outcome: ReservationOutcome;
    try {
      outcome = await this.repo.reserveForOrder(order.id, lines);
    } catch (error) {
      // The repository already exhausted its bounded retry for transient
      // faults, so reaching here means retrying inline would not help either.
      const retryable = isRetryableDatabaseError(error);
      const code: ReservationOutcomeCode = retryable ? 'RETRYABLE_FAILURE' : 'TERMINAL_FAILURE';
      outcome = {
        ...summariseReservation(order.id, [], false),
        code,
        state: 'UNRESERVED_BLOCKED',
        warnings: [
          retryable
            ? 'STOCK_NOT_CONFIRMED: the stock system was temporarily unavailable. This order is held and is not ready for preparation.'
            : 'STOCK_NOT_CONFIRMED: stock could not be reserved. This order is held and is not ready for preparation.',
        ],
      };
      await this.raise({
        orderId: order.id,
        code,
        attempts: 1,
        // Message only — never the error object, which can carry query text.
        detail: messageOf(error),
      });
    }

    await this.recordState(order.id, outcome.state);

    if (outcome.code === 'INSUFFICIENT_STOCK') {
      await this.raise({
        orderId: order.id,
        code: outcome.code,
        attempts: 1,
        detail: 'A stock-controlled line could not be reserved.',
      });
    }

    return outcome;
  }

  private async recordState(orderId: string, state: OrderReservationState): Promise<void> {
    if (!this.orderState) return;
    try {
      await this.orderState.setReservationState(orderId, state);
    } catch (error) {
      // Failing to record the state must not itself become a silent success:
      // the order stays PENDING, which fails closed for payment and fulfilment.
      await this.raise({
        orderId,
        code: 'TERMINAL_FAILURE',
        attempts: 1,
        detail: `Reservation state could not be recorded: ${messageOf(error)}`,
      });
    }
  }

  private async raise(alert: ReservationAlert): Promise<void> {
    if (!this.onAlert) return;
    try {
      await this.onAlert(alert);
    } catch {
      // An alerting failure must never mask the reservation outcome.
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
