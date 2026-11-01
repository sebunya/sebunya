import { logger } from './logger';
import { setAppLogger } from '../../application/logging/appLogger';
import { ILogger } from '../../application/ports/ILogger';

/**
 * Binds the application `appLogger` port to the canonical pino logger. Imported
 * for its side effect by the composition root so application-layer logging is
 * structured, redacted and trace-correlated in every real runtime — without the
 * application layer importing infrastructure.
 */
const pinoAdapter: ILogger = {
  debug: (obj, msg) => (typeof obj === 'string' ? logger.debug(obj) : logger.debug(obj as object, msg)),
  info: (obj, msg) => (typeof obj === 'string' ? logger.info(obj) : logger.info(obj as object, msg)),
  warn: (obj, msg) => (typeof obj === 'string' ? logger.warn(obj) : logger.warn(obj as object, msg)),
  error: (obj, msg) => (typeof obj === 'string' ? logger.error(obj) : logger.error(obj as object, msg)),
};

setAppLogger(pinoAdapter);
