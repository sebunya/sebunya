import { PreferenceMeasurementPublisher, PreferenceMeasurementEvent } from '../../application/ports/preferences/PreferenceMeasurementPublisher';
import { IPurchaseMeasurementQueue } from '../../application/ports/measurement/PurchaseMeasurementQueue';
import { randomUUID } from 'crypto';

/**
 * Publishes preference events to the core Measurement Control Tower queue safely.
 * Relies on the measurement layer's existing redaction/consent checks.
 */
export class MeasurementPreferencePublisher implements PreferenceMeasurementPublisher {
  constructor(private measurementQueue: IPurchaseMeasurementQueue) {}

  async publishPreferenceUpdate(event: PreferenceMeasurementEvent): Promise<void> {
    // We repurpose the existing robust measurement queue for async processing
    // Note: The queue accepts MeasurementEvent. We format it to match that port.
    await this.measurementQueue.enqueuePurchaseMeasurement({
      eventId: `pref_${randomUUID()}`,
      orderId: event.userId, // We overload orderId with userId for non-transactional measurement routing, safely isolated by type
      paymentReference: 'PREFERENCE',
      idempotencyKey: `pref_${randomUUID()}`,
    });
  }
}
