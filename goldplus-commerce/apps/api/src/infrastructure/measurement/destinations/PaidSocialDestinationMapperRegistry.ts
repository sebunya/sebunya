import { IPaidSocialDestinationMapperRegistry, PaidSocialDestinationMapper } from '../../../application/ports/measurement/PaidSocialDestinationMapper';

export class PaidSocialDestinationMapperRegistry implements IPaidSocialDestinationMapperRegistry {
  private readonly mappers = new Map<string, PaidSocialDestinationMapper>();

  constructor(mappers: PaidSocialDestinationMapper[]) {
    for (const mapper of mappers) {
      this.mappers.set(mapper.destinationKey, mapper);
    }
  }

  getMapper(destinationKey: string): PaidSocialDestinationMapper | undefined {
    return this.mappers.get(destinationKey);
  }

  hasMapper(destinationKey: string): boolean {
    return this.mappers.has(destinationKey);
  }

  getSupportedDestinations(): string[] {
    return Array.from(this.mappers.keys());
  }
}
