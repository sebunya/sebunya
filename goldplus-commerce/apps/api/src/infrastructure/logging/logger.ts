import pino from 'pino';
import { traceLocalStorage } from '../observability/TraceContext';

// Initialize Structured Logger with dynamic context injection
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  mixin() {
    const store = traceLocalStorage.getStore();
    const workerInstance = process.env.HOSTNAME || 'api-node-1';
    
    if (store) {
      return {
        traceId: store.traceId,
        spanId: store.spanId,
        jobId: store.jobId,
        userId: store.userId,
        workerInstance,
      };
    }
    
    return {
      workerInstance,
    };
  },
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
});
