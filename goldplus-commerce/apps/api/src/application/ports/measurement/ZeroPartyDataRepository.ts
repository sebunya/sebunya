import type { ZeroPartySignal } from '@goldplus/shared';

export interface ZeroPartyDataRepository {
  insertSignal(signal: ZeroPartySignal, capturedAt: Date): Promise<{ id: string }>;
}
