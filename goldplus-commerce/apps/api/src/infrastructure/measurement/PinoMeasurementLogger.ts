import { logger } from '../logging/logger';
import type { MeasurementLogger } from '../../application/ports/measurement/MeasurementLogger';

export class PinoMeasurementLogger implements MeasurementLogger {
  info(obj: object, msg: string): void {
    logger.info(obj, msg);
  }
  warn(obj: object, msg: string): void {
    logger.warn(obj, msg);
  }
  error(obj: object, msg: string): void {
    logger.error(obj, msg);
  }
}
