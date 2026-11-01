import { ILogger } from '../ports/ILogger';

/**
 * The application-layer logging entry point. Lives in `application` (never
 * imports infrastructure), so use-cases can log through it without breaking the
 * hexagonal boundary. The composition root injects the real pino-backed
 * implementation via `setAppLogger` at bootstrap; before that it is a no-op.
 */
const noop: ILogger = { debug() {}, info() {}, warn() {}, error() {} };

let current: ILogger = noop;

export function setAppLogger(logger: ILogger): void {
  current = logger;
}

/** Test seam. */
export function resetAppLogger(): void {
  current = noop;
}

export const appLogger: ILogger = {
  debug: (obj, msg) => current.debug(obj, msg),
  info: (obj, msg) => current.info(obj, msg),
  warn: (obj, msg) => current.warn(obj, msg),
  error: (obj, msg) => current.error(obj, msg),
};
