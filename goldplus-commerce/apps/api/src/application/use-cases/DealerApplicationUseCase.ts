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
  location: string;
}

export class DealerApplicationUseCase {
  constructor(private readonly dealerRepo: DrizzleDealerRepository) {}

  public async execute(dto: DealerApplicationDto): Promise<void> {
    const businessName = (dto.businessName ?? '').trim();
    const contactName = (dto.contactName ?? '').trim();
    const email = normalizeEmail(dto.email);
    const phone = normalizePhone(dto.phone);
    const location = (dto.location ?? '').trim();

    if (!businessName) throw new Error('Business name is required.');
    if (!contactName) throw new Error('Contact person name is required.');
    if (!location) throw new Error('Business location is required.');

    if (!isValidEmail(email)) {
      throw new Error('A valid email address is required.');
    }
    if (!isValidUgandanPhone(phone)) {
      throw new Error('A valid Ugandan phone number is required.');
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
