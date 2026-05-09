import { IEventPublisher } from '../ports';
import { DOMAIN_EVENTS } from '@goldplus/shared';

export class VerificationCheckUseCase {
  constructor(private readonly eventPublisher: IEventPublisher) {}

  public async execute(code: string): Promise<boolean> {
    // 1. Look up code in Database
    const isValid = code === 'VALID-CODE'; // Mock logic for MVP
    
    if (isValid) {
      await this.eventPublisher.publish(DOMAIN_EVENTS.PRODUCT_VERIFIED, { code });
      return true;
    } else {
      await this.eventPublisher.publish(DOMAIN_EVENTS.VERIFICATION_FAILED, { code });
      return false;
    }
  }
}
