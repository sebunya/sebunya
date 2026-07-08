import { IPaidSocialDestinationMapperRegistry, DestinationMapperResult } from '../../ports/measurement/PaidSocialDestinationMapper';

export class PreparePaidSocialPayloadUseCase {
  constructor(
    private readonly mapperRegistry: IPaidSocialDestinationMapperRegistry
  ) {}

  execute(destinationKey: string, eventName: string, eventId: string, rawPayload: any): DestinationMapperResult {
    const mapper = this.mapperRegistry.getMapper(destinationKey);
    
    if (!mapper) {
      return {
        success: false,
        status: 'VALIDATION_FAILED', // Since destination is not supported
        destination: destinationKey,
        eventName,
        eventId,
        errors: [`No mapper found for destination ${destinationKey}`]
      };
    }

    return mapper.mapEvent(eventName, eventId, rawPayload);
  }
}
