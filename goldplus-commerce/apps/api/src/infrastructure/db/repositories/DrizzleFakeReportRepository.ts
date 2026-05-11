import { desc } from 'drizzle-orm';
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
}
