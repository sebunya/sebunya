import { DrizzleDealerRepository } from '../../infrastructure/db/repositories/DrizzleDealerRepository';
import { Dealer } from '../../domain/dealers/Dealer';
import * as nodeCrypto from 'node:crypto';
import { isValidEmail, isValidUgandanPhone, normalizeEmail, normalizePhone } from '../services/validationHelpers';


export interface DealerApplicationDto {
  id?: string; // Allow caller to inject ID for auditing trace
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  tinNumber: string;
  // TODO: migrate this workflow to persist structuredLocation as JSON metadata or dedicated columns.
  location: string;
}

/**
 * A message that is safe to show the applicant. The route echoes only this
 * type: every other failure (a database outage, a bug) is reported as a
 * generic message, because this endpoint is unauthenticated and its error
 * text used to be whatever was thrown.
 */
export class DealerApplicationValidationError extends Error {}

export class DealerApplicationUseCase {
  constructor(private readonly dealerRepo: DrizzleDealerRepository) {}

  public async execute(dto: DealerApplicationDto): Promise<void> {
    const businessName = (dto.businessName ?? '').trim();
    const contactName = (dto.contactName ?? '').trim();
    const email = normalizeEmail(dto.email);
    const phone = normalizePhone(dto.phone);
    const location = (dto.location ?? '').trim();

    if (!businessName) throw new DealerApplicationValidationError('Business name is required.');
    if (!contactName) throw new DealerApplicationValidationError('Contact person name is required.');
    if (!location) throw new DealerApplicationValidationError('Business location is required.');

    if (!isValidEmail(email)) {
      throw new DealerApplicationValidationError('A valid email address is required.');
    }
    if (!isValidUgandanPhone(phone)) {
      throw new DealerApplicationValidationError('A valid Ugandan phone number is required.');
    }

    const id = dto.id ?? nodeCrypto.randomUUID();
    const dealer = Dealer.apply(
      id,
      businessName,
      contactName,
      email,
      phone,
      (dto.tinNumber ?? '').trim() || 'PENDING',
      location
    );

    await this.dealerRepo.save(dealer);
  }
}
