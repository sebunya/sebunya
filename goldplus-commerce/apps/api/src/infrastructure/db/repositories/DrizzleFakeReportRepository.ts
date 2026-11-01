import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { fakeProductReports } from '../schema/governance';
import { FakeReport, FakeReportStatus } from '../../../domain/fakeReports/FakeReport';
import { IFakeReportRepository, FakeReportAdminPage, FakeReportAdminRow } from '../../../application/ports/IFakeReportRepository';

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

  /** Admin list: newest first, paged, redacted (no reporter name/contact/account). */
  async listForAdmin(input: { page: number; pageSize: number; status?: string | null }): Promise<FakeReportAdminPage> {
    const pageSize = Math.min(Math.max(Math.trunc(input.pageSize) || 25, 1), 100);
    const page = Math.max(Math.trunc(input.page) || 1, 1);
    const where = input.status ? eq(fakeProductReports.status, input.status) : undefined;
    const [rows, [count], statusRows, locationRows] = await Promise.all([
      db.select({
        id: fakeProductReports.id,
        status: fakeProductReports.status,
        productDescription: fakeProductReports.productDescription,
        locationFound: fakeProductReports.locationFound,
        hologramCode: fakeProductReports.hologramCode,
        evidenceUrls: fakeProductReports.evidenceUrls,
        reporterUserId: fakeProductReports.reporterUserId,
        createdAt: fakeProductReports.createdAt,
      }).from(fakeProductReports).where(where)
        .orderBy(desc(fakeProductReports.createdAt))
        .limit(pageSize).offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)::int` }).from(fakeProductReports).where(where),
      db.select({ status: fakeProductReports.status, n: sql<number>`count(*)::int` })
        .from(fakeProductReports).groupBy(fakeProductReports.status),
      // "Kikuubo" and "kikuubo " are one place.
      db.select({ location: sql<string>`lower(trim(${fakeProductReports.locationFound}))`, n: sql<number>`count(*)::int` })
        .from(fakeProductReports).groupBy(sql`lower(trim(${fakeProductReports.locationFound}))`)
        .orderBy(desc(sql`count(*)`)).limit(5),
    ]);
    return {
      items: rows.map(toAdminRow),
      total: Number(count?.n ?? 0),
      page,
      pageSize,
      statusCounts: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)])),
      topLocations: locationRows.map((r) => ({ location: r.location, reports: Number(r.n) })),
    };
  }
}

export function toAdminRow(row: {
  id: string; status: string; productDescription: string; locationFound: string;
  hologramCode: string | null; evidenceUrls: unknown; reporterUserId: string | null; createdAt: Date;
}): FakeReportAdminRow {
  return {
    id: row.id,
    status: row.status,
    productDescription: row.productDescription,
    locationFound: row.locationFound,
    hologramCodeProvided: Boolean(row.hologramCode),
    evidenceCount: Array.isArray(row.evidenceUrls) ? row.evidenceUrls.length : 0,
    reporterSignedIn: Boolean(row.reporterUserId),
    createdAt: row.createdAt.toISOString(),
  };
}
