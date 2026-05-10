import { DrizzleDealerRepository } from '../../infrastructure/db/repositories/DrizzleDealerRepository';
import { Dealer } from '../../domain/dealers/Dealer';
import * as nodeCrypto from 'node:crypto';


export interface DealerApplicationDto {
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

    const dealer = Dealer.apply(
      nodeCrypto.randomUUID(),

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
