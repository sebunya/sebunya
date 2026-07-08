import { PaidSocialDestinationRepository, PaidSocialDestination } from '../../application/ports/measurement/PaidSocialDestinationRepository';

export class DrizzlePaidSocialDestinationRepository implements PaidSocialDestinationRepository {
  async getActiveDestinations(): Promise<PaidSocialDestination[]> {
    // Simulated active destinations (would be fetched from DB)
    return [
      {
        id: 'dest-1',
        name: 'Meta CAPI',
        isActive: true,
        config: {},
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'dest-2',
        name: 'TikTok Events API',
        isActive: true,
        config: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
  }

  async getDestinationById(id: string): Promise<PaidSocialDestination | null> {
    return null;
  }
}
