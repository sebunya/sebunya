/** Aggregated operational report over the whole fulfilment pipeline (F5). */
export interface FulfilmentReport {
  generatedAt: string;
  queue: {
    total: number;
    active: number;
    unassigned: number;
    byStatus: Record<string, number>;
  };
  sla: { onTrack: number; dueSoon: number; overdue: number; escalated: number };
  packing: { packedTasks: number; backorderedTasks: number };
  dispatch: { dispatched: number };
  delivery: {
    delivered: number;
    failed: number;
    rescheduled: number;
    returnToOrigin: number;
    partiallyDelivered: number;
  };
  cycleTime: { deliveredCount: number; avgHoursCreatedToDelivered: number | null };
  byTeam: { teamId: string | null; active: number }[];
  byAssignee: { assignedTo: string | null; active: number }[];
}

export interface IFulfilmentReportRepository {
  buildReport(now: Date): Promise<FulfilmentReport>;
}
