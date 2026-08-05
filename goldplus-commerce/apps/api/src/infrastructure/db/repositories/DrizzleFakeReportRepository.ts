import { desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { fakeProductReports } from '../schema/governance';
import { FakeReport, FakeReportStatus } from '../../../domain/fakeReports/FakeReport';
import { IFakeReportRepository } from '../../../application/ports/IFakeReportRepository';

function rowToEntity(row: typeof fakeProductReports.$inferSelect): FakeReport {
  return new FakeReport(
    row.id,
    row.reporterName ?? null,
    row.reporterContact ?? null,
    row.locationFound,
    row.productDescription,
    row.hologramCode ?? null,
    (row.evidenceUrls ?? []) as string[],
    row.status as FakeReportStatus,
    row.createdAt,
  );
}

export class DrizzleFakeReportRepository implements IFakeReportRepository {
  async save(report: FakeReport): Promise<void> {
    await db
      .insert(fakeProductReports)
      .values({
        id: report.id,
        reporterName: report.reporterName,
        reporterContact: report.reporterContact,
        locationFound: report.locationFound,
        productDescription: report.productDescription,
        hologramCode: report.hologramCode,
        evidenceUrls: report.evidenceUrls,
        status: report.status,
        createdAt: report.createdAt,
      })
      .onConflictDoUpdate({
        target: fakeProductReports.id,
        set: { status: report.status },
      });
  }

  async findAll(): Promise<FakeReport[]> {
    const rows = await db.query.fakeProductReports.findMany({
      orderBy: [desc(fakeProductReports.createdAt)],
      limit: 200,
    });
    return rows.map(rowToEntity);
  }

  /* ── 0087 gamification: attribution + audited confirmation ─────────────── */

  async attributeReporter(reportId: string, userId: string): Promise<void> {
    await db
      .update(fakeProductReports)
      .set({ reporterUserId: userId })
      .where(eq(fakeProductReports.id, reportId));
  }

  async findByIdRaw(reportId: string): Promise<{ id: string; status: string; reporterUserId: string | null; loyaltyEntryId: string | null } | null> {
    const row = await db.query.fakeProductReports.findFirst({ where: eq(fakeProductReports.id, reportId) });
    return row
      ? { id: row.id, status: row.status, reporterUserId: row.reporterUserId ?? null, loyaltyEntryId: row.loyaltyEntryId ?? null }
      : null;
  }

  async setStatus(reportId: string, status: string, loyaltyEntryId?: string | null): Promise<void> {
    await db
      .update(fakeProductReports)
      .set({ status, ...(loyaltyEntryId !== undefined ? { loyaltyEntryId } : {}) })
      .where(eq(fakeProductReports.id, reportId));
  }
}
