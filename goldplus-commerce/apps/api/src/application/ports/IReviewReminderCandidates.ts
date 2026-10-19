/**
 * Orders that may be asked, once more, to rate what was bought: closed
 * (delivered, or completed at the counter) inside the window, not reversed,
 * nothing on them reviewed yet, no open Care Desk task about them, and no
 * reminder already enqueued.
 */
export interface IReviewReminderCandidates {
  findDue(input: { closedBefore: Date; closedAfter: Date; limit: number }): Promise<string[]>;
}
