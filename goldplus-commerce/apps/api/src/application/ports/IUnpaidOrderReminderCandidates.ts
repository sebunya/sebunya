/**
 * Online orders that may get the one payment reminder: placed inside the window, never paid, not cancelled, no
 * payment attempt that is clearing or completed, no later order from the same phone, no open Care Desk task, and
 * no reminder already enqueued.
 */
export interface IUnpaidOrderReminderCandidates {
  findDue(input: { placedBefore: Date; placedAfter: Date; limit: number }): Promise<string[]>;
}
