/**
 * Resolving a counterfeit report. Confirmation is a loyalty earn event (0087), so this
 * mutates loyalty liability: it runs here, not in the route, with the audit entry.
 */
export type FakeReportStatus = 'investigating' | 'verified_fake' | 'dismissed';

export interface ResolveFakeReportDeps {
  reports: {
    findByIdRaw(id: string): Promise<{ id: string; reporterUserId: string | null; loyaltyEntryId: string | null } | null>;
    setStatus(id: string, status: string, loyaltyEntryId?: string): Promise<unknown>;
  };
  earn: { execute(input: { reportId: string; reporterUserId: string }): Promise<unknown> };
  notify: { enqueue(input: { userId: string; eventType: 'LOYALTY_POINTS_EARNED'; idempotencyKey: string; data: Record<string, unknown> }): Promise<unknown> };
  audit: { execute(input: { actorId: string; action: string; entity: string; entityId: string; newState: Record<string, unknown> }): Promise<unknown> };
}

export type ResolveFakeReportResult =
  | { ok: true; id: string; status: FakeReportStatus; loyalty: { points: number } | null }
  | { ok: false; code: 'BAD_STATUS' | 'NOT_FOUND'; message: string };

export class ResolveFakeReportUseCase {
  constructor(private readonly deps: ResolveFakeReportDeps) {}

  async execute(input: { reportId: string; status: string; actorId: string }): Promise<ResolveFakeReportResult> {
    const status = input.status as FakeReportStatus;
    if (!['investigating', 'verified_fake', 'dismissed'].includes(status)) {
      return { ok: false, code: 'BAD_STATUS', message: 'status must be investigating, verified_fake or dismissed.' };
    }
    const report = await this.deps.reports.findByIdRaw(input.reportId);
    if (!report) return { ok: false, code: 'NOT_FOUND', message: 'Report not found.' };

    let loyalty: { points: number } | null = null;
    let entryId: string | undefined;
    if (status === 'verified_fake' && report.reporterUserId && !report.loyaltyEntryId) {
      const earn = (await this.deps.earn
        .execute({ reportId: report.id, reporterUserId: report.reporterUserId })
        .catch(() => null)) as { points?: number; entryId?: string } | null;
      if (earn && typeof earn.points === 'number') {
        loyalty = { points: earn.points };
        entryId = earn.entryId;
      }
    }
    if (entryId !== undefined) await this.deps.reports.setStatus(report.id, status, entryId);
    else await this.deps.reports.setStatus(report.id, status);
    if (loyalty && report.reporterUserId) {
      // Support pathway: the confirmed reporter gets a follow-up message.
      await this.deps.notify
        .enqueue({
          userId: report.reporterUserId,
          eventType: 'LOYALTY_POINTS_EARNED',
          idempotencyKey: `counterfeit-confirmed:${report.id}`,
          data: { points: loyalty.points, source: 'counterfeit_report' },
        })
        .catch(() => undefined);
    }
    await this.deps.audit.execute({
      actorId: input.actorId,
      action: 'FAKE_REPORT_STATUS_CHANGED',
      entity: 'fake_report',
      entityId: report.id,
      newState: { status, loyaltyPointsAwarded: loyalty?.points ?? 0 },
    });
    return { ok: true, id: report.id, status, loyalty };
  }
}
