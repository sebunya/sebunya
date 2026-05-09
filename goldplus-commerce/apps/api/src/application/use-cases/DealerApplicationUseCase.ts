import { IEventPublisher } from '../ports';
import { DOMAIN_EVENTS } from '@goldplus/shared';

export interface DealerApplicationDto {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  taxId?: string;
}

export class DealerApplicationUseCase {
  constructor(private readonly eventPublisher: IEventPublisher) {}

  public async execute(dto: DealerApplicationDto): Promise<void> {
    if (!dto.businessName || !dto.email || !dto.phone) {
      throw new Error('Business name, email, and phone are required.');
    }

    // Process logic here (save to DB)
    
    await this.eventPublisher.publish(DOMAIN_EVENTS.DEALER_APPLICATION_SUBMITTED, dto);
  }
}
