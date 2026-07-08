export interface PaidSocialCredentialStatusRepository {
  getCredentialStatus(destinationId: string): Promise<{ configured: boolean; valid: boolean }>;
}
