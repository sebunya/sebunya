export type DestinationMapperResult = {
  success: boolean;
  status:
    | 'MAPPED'
    | 'UNSUPPORTED_EVENT'
    | 'VALIDATION_FAILED'
    | 'PII_BLOCKED'
    | 'DESTINATION_DISABLED';
  destination: string;
  eventName: string;
  destinationEventName?: string;
  eventId?: string;
  idempotencyKey?: string;
  payload?: unknown;
  redactedSummary?: unknown;
  errors?: string[];
};

export interface PaidSocialDestinationMapper {
  readonly destinationKey: string;
  readonly supportedEvents: string[];

  mapEvent(eventName: string, eventId: string, rawPayload: any): DestinationMapperResult;
  validateEvent(eventName: string, rawPayload: any): { valid: boolean; errors: string[] };
}

export interface IPaidSocialDestinationMapperRegistry {
  getMapper(destinationKey: string): PaidSocialDestinationMapper | undefined;
  hasMapper(destinationKey: string): boolean;
  getSupportedDestinations(): string[];
}
