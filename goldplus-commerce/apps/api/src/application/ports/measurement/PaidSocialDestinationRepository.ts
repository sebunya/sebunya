export interface PaidSocialDestination {
  id: string;
  name: string;
  isActive: boolean;
  config: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaidSocialDestinationRepository {
  getActiveDestinations(): Promise<PaidSocialDestination[]>;
  getDestinationById(id: string): Promise<PaidSocialDestination | null>;
}
