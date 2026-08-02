/**
 * Process lifecycle signal for truthful readiness (Slice 3F).
 *
 * When shutdown begins, readiness must go false BEFORE the server stops
 * accepting connections, so the load balancer notices and drains this instance
 * instead of racing a connection into a socket that is about to close. Liveness
 * stays true — the process is alive and finishing in-flight work; it simply must
 * not receive NEW traffic.
 */
let draining = false;

export function beginDraining(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}

/** Test seam. */
export function resetDrainingForTests(): void {
  draining = false;
}
