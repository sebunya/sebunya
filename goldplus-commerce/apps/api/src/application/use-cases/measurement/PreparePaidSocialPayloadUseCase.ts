import { PaidSocialPayloadMapper } from '../../services/measurement/PaidSocialPayloadMapper';
import { PaidSocialPayloadRedactor } from '../../services/measurement/PaidSocialPayloadRedactor';

export class PreparePaidSocialPayloadUseCase {
  constructor(
    private readonly mapper: PaidSocialPayloadMapper,
    private readonly redactor: PaidSocialPayloadRedactor
  ) {}

  execute(eventName: string, rawPayload: any, platform: string): any {
    const mapped = this.mapper.map(eventName, rawPayload, platform);
    return this.redactor.redactPii(mapped);
  }
}
