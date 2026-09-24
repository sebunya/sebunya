import type { DlqRepository } from '../../ports/measurement/DlqRepository';

/** What the dead-letter screen shows about one failed dispatch. Nothing about the visitor. */
export interface MeasurementDlqListItem {
  id: string;
  eventName: string;
  eventId: string;
  totalAttempts: number;
  failedReason: string;
  failedAt: Date | string;
}

/**
 * Lists unresolved dead-lettered measurement dispatches for the admin screen.
 *
 * It used to return the stored rows whole, and each row's payload carries the
 * visitor's user_data — IP address, user agent, first-party id, click ids,
 * hashed email and phone — to anyone holding reports.read (marketing,
 * commercial, analyst roles). The only consumer renders six fields, so only
 * those six leave the server. Replay reads the payload server-side by id.
 */
export class ListMeasurementDlqUseCase {
  constructor(private readonly dlqRepo: DlqRepository) {}

  async execute(limit: number = 100): Promise<MeasurementDlqListItem[]> {
    const rows = await this.dlqRepo.listUnresolved(limit);
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      eventName: String(r.eventName ?? ''),
      eventId: String(r.eventId ?? ''),
      totalAttempts: Number(r.totalAttempts ?? 0),
      failedReason: String(r.failedReason ?? ''),
      failedAt: (r.failedAt as Date | string) ?? '',
    }));
  }
}
