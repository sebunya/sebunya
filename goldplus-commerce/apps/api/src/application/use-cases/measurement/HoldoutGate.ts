import { createHash } from 'crypto';
import { DEFAULT_HOLDOUT_SHARE, holdoutArm, waveKeyFor, type HoldoutArm } from '../../../domain/measurement/Incrementality';
import { effectiveNumber } from '../../../domain/measurement/MeasurementConfig';
import type { MeasurementConfigPort } from '../../ports/measurement/MeasurementConfigPort';

export interface HoldoutStore {
  salt(): Promise<string>;
  /** Insert-if-absent; returns the arm on record (an earlier decision for the same subject wins). */
  recordAssignment(row: { programme: string; waveKey: string; subjectRef: string; customerKey: string; arm: HoldoutArm; channel: string | null; at: Date }): Promise<HoldoutArm>;
}

export interface HoldoutDecisionInput {
  programme: 'review_reminder' | 'loyalty_mission' | 'loyalty_expiry' | 'abandoned_basket' | 'campaign';
  /** What the message is about (order id, mission key + user): one decision per subject per wave. */
  subjectRef: string;
  /** The person: a user id, else a phone. Arms are stable per person within a wave. */
  userId?: string | null;
  phone?: string | null;
  channel?: string | null;
  at?: Date;
}

/** sha256 of the digits of a phone: the same key the outcome job computes from orders.customer_phone. */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^0/, '256');
  return `phone:${createHash('sha256').update(digits).digest('hex')}`;
}
export const userKey = (userId: string): string => `user:${userId}`;

/**
 * Decides, records and answers: should this promotional message go out? 'hold' means do not send; the person is
 * the control arm for this wave and the nightly outcome job compares what they bought with the treated arm.
 * Never throws: when anything fails the answer is 'treat' (a message sent is the old behaviour; a message held by
 * accident would be an unmeasured loss).
 */
export class HoldoutGate {
  constructor(private readonly config: MeasurementConfigPort, private readonly store: HoldoutStore) {}

  async decide(input: HoldoutDecisionInput): Promise<HoldoutArm> {
    try {
      const customerKey = input.userId ? userKey(input.userId) : input.phone ? phoneKey(input.phone) : null;
      if (!customerKey) return 'treat';
      const values = await this.config.values();
      const share = effectiveNumber(values, `holdout_share_${input.programme}`) ?? DEFAULT_HOLDOUT_SHARE;
      if (share <= 0) return 'treat';
      const at = input.at ?? new Date();
      const waveKey = waveKeyFor(at);
      const arm = holdoutArm({ programme: input.programme, waveKey, subjectKey: customerKey, salt: await this.store.salt(), share });
      return await this.store.recordAssignment({ programme: input.programme, waveKey, subjectRef: input.subjectRef, customerKey, arm, channel: input.channel ?? null, at });
    } catch {
      return 'treat';
    }
  }
}
