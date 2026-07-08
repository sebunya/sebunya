import { ConsentService } from '../../application/use-cases/measurement/ConsentService';

export class ConsentAwareMeasurementPolicy {
  constructor(private readonly consentService: ConsentService) {}

  async canSendPaidSocialEvent(userId: string | undefined, sessionId: string): Promise<boolean> {
    const consent = await this.consentService.getCurrentState(userId, sessionId);
    return consent.analytics === true && consent.advertising === true;
  }
}
