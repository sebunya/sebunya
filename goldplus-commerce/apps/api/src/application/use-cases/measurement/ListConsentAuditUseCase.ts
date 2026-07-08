import type { ConsentReadRepository } from '../../ports/measurement/ConsentReadRepository';

export class ListConsentAuditUseCase {
  constructor(private readonly consentReadRepo: ConsentReadRepository) {}

  async execute(limit: number) {
    return await this.consentReadRepo.listAuditTrail(limit);
  }
}
