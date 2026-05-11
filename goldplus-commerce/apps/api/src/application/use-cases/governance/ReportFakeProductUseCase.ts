import { randomUUID } from 'node:crypto';
import { IFakeReportRepository } from '../../ports/IFakeReportRepository';
import { FakeReport } from '../../../domain/fakeReports/FakeReport';

export interface ReportFakeProductInput {
  locationFound: string;
  productDescription: string;
  hologramCode?: string;
  reporterContact?: string;
  reporterName?: string;
}

export type ReportFakeProductResult =
  | { ok: true; reportId: string }
  | { ok: false; code: 'BAD_INPUT'; message: string };

export class ReportFakeProductUseCase {
  constructor(private readonly reports: IFakeReportRepository) {}

  async execute(input: ReportFakeProductInput): Promise<ReportFakeProductResult> {
    const locationFound = (input.locationFound ?? '').trim();
    const productDescription = (input.productDescription ?? '').trim();

    if (!locationFound) return { ok: false, code: 'BAD_INPUT', message: 'Location found is required.' };
    if (!productDescription) return { ok: false, code: 'BAD_INPUT', message: 'Product description is required.' };
    if (locationFound.length > 255) return { ok: false, code: 'BAD_INPUT', message: 'Location is too long.' };
    if (productDescription.length > 5000) return { ok: false, code: 'BAD_INPUT', message: 'Description is too long.' };

    const id = randomUUID();
    const report = FakeReport.report(id, locationFound, productDescription, {
      hologramCode: input.hologramCode ?? null,
      reporterContact: input.reporterContact ?? null,
      reporterName: input.reporterName ?? null,
    });
    await this.reports.save(report);
    return { ok: true, reportId: id };
  }
}
