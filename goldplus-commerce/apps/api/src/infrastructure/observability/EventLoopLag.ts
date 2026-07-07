import { monitorEventLoopDelay } from 'perf_hooks';

export class EventLoopLagMonitor {
  private histogram = monitorEventLoopDelay({ resolution: 10 });

  constructor() {
    this.histogram.enable();
  }

  /**
   * Returns the mean event loop lag in milliseconds
   */
  getLagMs(): number {
    return this.histogram.mean / 1_000_000;
  }

  /**
   * Returns the maximum event loop lag in milliseconds
   */
  getMaxLagMs(): number {
    return this.histogram.max / 1_000_000;
  }

  /**
   * Resets the histogram values
   */
  reset(): void {
    this.histogram.reset();
  }
}

export const eventLoopLagMonitor = new EventLoopLagMonitor();
