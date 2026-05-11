import { DrizzleDealerRepository } from '../../infrastructure/db/repositories/DrizzleDealerRepository';
import { Dealer } from '../../domain/dealers/Dealer';
import * as nodeCrypto from 'node:crypto';


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
    if (!dto.businessName || !dto.email || !dto.phone) {
      throw new Error('Business name, email, and phone are required.');
    }

    const id = dto.id ?? nodeCrypto.randomUUID();
    const dealer = Dealer.apply(
      id,

      dto.businessName,
      dto.contactName,
      dto.email,
      dto.phone,
      dto.tinNumber,
      dto.location
    );

    await this.dealerRepo.save(dealer);
  }
}
