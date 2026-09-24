import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { isTerminalFulfilmentStatus } from '../../../domain/fulfilment/FulfilmentTask';
import type { TransitionFulfilmentTaskUseCase } from './TransitionFulfilmentTaskUseCase';

export type CancelTaskForOrderResult =
  | { outcome: 'cancelled'; taskId: string }
  | { outcome: 'no_task' | 'already_closed' }
  | { outcome: 'refused'; code: string; message: string };

/**
 * Closes the fulfilment task of an order that has just been CANCELLED by
 * something other than an operator on the fulfilment screen (a total refund).
 *
 * The refund path cancels the order and releases its stock, but the task stayed
 * NEW/PICKING in the work queue, so a picker could still pack goods for an
 * order whose money had gone back. The move goes through the real transition
 * use case (state machine, terminal-order guard, audit row), never a status
 * overwrite, and it does not touch stock: the order cancellation already
 * released it. Idempotent: an already-terminal task is left alone.
 */
export class CancelFulfilmentTaskForCancelledOrderUseCase {
  constructor(
    private readonly repo: Pick<IFulfilmentRepository, 'findByOrderId'>,
    private readonly transitions: Pick<TransitionFulfilmentTaskUseCase, 'execute'>,
  ) {}

  async execute(input: { orderId: string; actorId: string | null; reason: string }): Promise<CancelTaskForOrderResult> {
    const task = await this.repo.findByOrderId(input.orderId);
    if (!task) return { outcome: 'no_task' };
    if (isTerminalFulfilmentStatus(task.status)) return { outcome: 'already_closed' };
    const result = await this.transitions.execute({
      taskId: task.id,
      toStatus: 'CANCELLED',
      actorId: input.actorId,
      notes: input.reason,
    });
    return result.ok ? { outcome: 'cancelled', taskId: task.id } : { outcome: 'refused', code: result.code, message: result.message };
  }
}
