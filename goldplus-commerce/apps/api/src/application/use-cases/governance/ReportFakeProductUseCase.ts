import { randomUUID } from 'node:crypto';
import { IFakeReportRepository } from '../../ports/IFakeReportRepository';
import { FakeReport } from '../../../domain/fakeReports/FakeReport';
import { isValidEmail, isValidUgandanPhone, normalizeEmail, normalizePhone, text,
} from '../../services/validationHelpers';

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
    const locationFound = text(input.locationFound);
    const productDescription = text(input.productDescription);
    const email = normalizeEmail(input.reporterEmail);
    const phone = normalizePhone(input.reporterPhone);

    if (!locationFound) return { ok: false, code: 'BAD_INPUT', message: 'Location found is required.' };
    if (!productDescription) return { ok: false, code: 'BAD_INPUT', message: 'Product description is required.' };
    if (locationFound.length > 255) return { ok: false, code: 'BAD_INPUT', message: 'Location is too long.' };
    if (productDescription.length > 5000) return { ok: false, code: 'BAD_INPUT', message: 'Description is too long.' };
    
    // Email is optional (owner decision 2026-09-24): the phone is how we
    // follow up, and a report must never be refused for a missing email.
    if (email && !isValidEmail(email)) {
      return { ok: false, code: 'BAD_INPUT', message: 'That email address does not look right. Check it, or leave it blank.' };
    }
    if (!isValidUgandanPhone(phone)) {
      return { ok: false, code: 'BAD_INPUT', message: 'A valid Ugandan phone number is required.' };
    }

    const id = randomUUID();
    // Pack combined contact information as per decision highlight
    const combinedContact = email ? `Email: ${email} | Phone: ${phone}` : `Phone: ${phone}`;

    const report = FakeReport.report(id, locationFound, productDescription, {
      hologramCode: input.hologramCode ?? null,
      reporterContact: combinedContact,
      reporterName: input.reporterName ?? null,
    });
    await this.reports.save(report);
    return { ok: true, reportId: id };
  }
}
