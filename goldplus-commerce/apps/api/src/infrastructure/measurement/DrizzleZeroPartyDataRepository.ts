import { db } from '../db/client';
import { zeroPartySignals } from '../db/schema/measurement';
import type { ZeroPartyDataRepository } from '../../application/ports/measurement/ZeroPartyDataRepository';
import type { ZeroPartySignal } from '@goldplus/shared';

export class DrizzleZeroPartyDataRepository implements ZeroPartyDataRepository {
  async insertSignal(signal: ZeroPartySignal, capturedAt: Date): Promise<{ id: string }> {
    const [inserted] = await db.insert(zeroPartySignals).values({
      fpClientId:      signal.fp_client_id,
      userId:          signal.user_id,
      sessionId:       signal.session_id,
      signalType:      signal.signal_type,
      payload:         signal.payload as any,
      pageLocation:    signal.page_location,
      productId:       signal.product_id,
      sourceComponent: signal.source_component,
      capturedAt,
    }).returning({ id: zeroPartySignals.id });
    
    return { id: inserted.id };
  }
}
