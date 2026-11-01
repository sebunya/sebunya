import { FakeReport } from '../../domain/fakeReports/FakeReport';

/** Admin list row: no reporter name, contact or account — personal data stays out of lists. */
export interface FakeReportAdminRow {
  id: string;
  status: string;
  productDescription: string;
  locationFound: string;
  hologramCodeProvided: boolean;
  evidenceCount: number;
  reporterSignedIn: boolean;
  createdAt: string;
}

export interface FakeReportAdminPage {
  items: FakeReportAdminRow[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
  topLocations: Array<{ location: string; reports: number }>;
}

export interface IFakeReportRepository {
  save(report: FakeReport): Promise<void>;
  findAll(): Promise<FakeReport[]>;
  listForAdmin?(input: { page: number; pageSize: number; status?: string | null }): Promise<FakeReportAdminPage>;
}
