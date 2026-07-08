import { PaidSocialCredentialStatusRepository } from '../../application/ports/measurement/PaidSocialCredentialStatusRepository';

export class EnvPaidSocialCredentialStatusRepository implements PaidSocialCredentialStatusRepository {
  async getCredentialStatus(destinationId: string): Promise<{ configured: boolean; valid: boolean }> {
    // Mock for now. In reality, checks specific ENV variables or DB stored keys
    return { configured: true, valid: true };
  }
}
