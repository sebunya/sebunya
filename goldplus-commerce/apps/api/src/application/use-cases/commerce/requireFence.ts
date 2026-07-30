/**
 * Fail-closed fence checking.
 *
 * Every fenced repository mutation returns whether this worker still owns the
 * lease, and the first version of the wiring ignored every one of those results:
 *
 *     await idem.linkOrder(lease, order.id);
 *     await idem.finishOperation(lease, order.id);
 *
 * A `false` there means another worker took the operation over. Continuing past
 * it is the whole failure the fence exists to prevent — the stale worker would go
 * on to reserve inventory, queue fulfilment, queue a notification and return
 * success for an operation it no longer owns, while its successor does the same.
 * The fence made that *detectable* and the caller threw the detection away.
 *
 * So the check is not optional here. `requireFence` turns a lost lease into a
 * typed, thrown outcome that aborts before the next side effect.
 */

export type FencedStage =
  | 'CLAIM'
  | 'LINK_ORDER'
  | 'ADVANCE_STAGE'
  | 'HEARTBEAT'
  /** Marks the workflow no longer running. Named for that, not for "completed". */
  | 'FINISH_OPERATION'
  | 'FAIL';

export class LeaseLostError extends Error {
  readonly code = 'LEASE_LOST';
  constructor(readonly stage: FencedStage) {
    super(`LEASE_LOST at ${stage}: this worker no longer owns the checkout claim.`);
    this.name = 'LeaseLostError';
  }
}

export interface FenceObserver {
  /** Metric + structured audit. Never receives customer data. */
  onLeaseLost(stage: FencedStage): void;
}

/**
 * Asserts the mutation actually applied.
 *
 * Throws rather than returning a boolean the caller may again ignore: the point
 * is that forgetting to check must not be possible at the call site.
 */
export function requireFence(
  applied: boolean,
  stage: FencedStage,
  observer?: FenceObserver,
): void {
  if (applied) return;
  observer?.onLeaseLost(stage);
  throw new LeaseLostError(stage);
}

export function isLeaseLost(error: unknown): error is LeaseLostError {
  return error instanceof LeaseLostError;
}
