import type { MicroConversionKey, SegmentRow } from '../../domain/measurement/Outcomes';

/** The counts behind the Outcomes page, for one window. Each is bounded: no customer records leave the database. */
export interface OutcomeCounts {
  cartsWithItems: number;
  /** Distinct browsers that sent begin_checkout in the window (telemetry outbox). */
  checkoutsStarted: number;
  ordersPlaced: number;
  /** Paid order totals in the window (for whales; bounded by the period). */
  paidTotalsUgx: number[];
  /** Per order placed in the window with at least one linked touch: first touch time, order time, touch count. */
  journeys: Array<{ firstTouchAt: Date; orderAt: Date; touches: number }>;
  micro: Partial<Record<MicroConversionKey, number>>;
  /** Media spend in the window from measurement.mmm_daily, in shillings. */
  spendUgx: number;
  ga4: {
    sessions: number;
    directSessions: number;
    /** Days of the window the GA4 series covers (GA4 runs a day or two behind). */
    daysCovered: number;
    byChannel: SegmentRow[];
    byDevice: SegmentRow[];
  };
}

export interface IOutcomesReader {
  counts(start: Date, end: Date, startDay: string, endDay: string): Promise<OutcomeCounts>;
}
