import { AsyncLocalStorage } from 'async_hooks';

export interface TraceContext {
  traceId: string;
  spanId?: string;
  jobId?: string;
  userId?: string;
}

export const traceLocalStorage = new AsyncLocalStorage<TraceContext>();

export function getTraceContext(): TraceContext | undefined {
  return traceLocalStorage.getStore();
}

export function runWithContext<T>(context: TraceContext, fn: () => Promise<T>): Promise<T> {
  return traceLocalStorage.run(context, fn);
}
