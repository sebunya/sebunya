import { FakeReport } from '../../domain/fakeReports/FakeReport';

export interface IFakeReportRepository {
  save(report: FakeReport): Promise<void>;
  findAll(): Promise<FakeReport[]>;
}
