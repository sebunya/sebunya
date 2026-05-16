import { randomUUID } from 'node:crypto';
import { IFakeReportRepository } from '../../ports/IFakeReportRepository';
import { FakeReport } from '../../../domain/fakeReports/FakeReport';
import { isValidEmail, isValidUgandanPhone, normalizeEmail, normalizePhone } from '../../services/validationHelpers';

export interface ReportFakeProductInput {
  // TODO: migrate this workflow to persist structuredLocation as JSON metadata or dedicated columns.
  locationFound: string;
  productDescription: string;
  reporterEmail: string;
  reporterPhone: string;
  hologramCode?: string;
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
    const email = normalizeEmail(input.reporterEmail);
    const phone = normalizePhone(input.reporterPhone);

    if (!locationFound) return { ok: false, code: 'BAD_INPUT', message: 'Location found is required.' };
    if (!productDescription) return { ok: false, code: 'BAD_INPUT', message: 'Product description is required.' };
    if (locationFound.length > 255) return { ok: false, code: 'BAD_INPUT', message: 'Location is too long.' };
    if (productDescription.length > 5000) return { ok: false, code: 'BAD_INPUT', message: 'Description is too long.' };
    
    if (!isValidEmail(email)) {
      return { ok: false, code: 'BAD_INPUT', message: 'A valid reporter email is required.' };
    }
    if (!isValidUgandanPhone(phone)) {
      return { ok: false, code: 'BAD_INPUT', message: 'A valid Ugandan phone number is required.' };
    }

    const id = randomUUID();
    // Pack combined contact information as per decision highlight
    const combinedContact = `Email: ${email} | Phone: ${phone}`;

    const report = FakeReport.report(id, locationFound, productDescription, {
      hologramCode: input.hologramCode ?? null,
      reporterContact: combinedContact,
      reporterName: input.reporterName ?? null,
    });
    await this.reports.save(report);
    return { ok: true, reportId: id };
  }
}
