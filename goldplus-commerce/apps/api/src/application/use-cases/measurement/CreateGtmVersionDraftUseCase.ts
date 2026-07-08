import { GtmRepository } from '../../ports/measurement/GtmRepository';

export class CreateGtmVersionDraftUseCase {
  constructor(private readonly gtmRepo: GtmRepository) {}

  async execute(workspacePath: string, name: string, notes?: string) {
    const status = await this.gtmRepo.getCredentialStatus();
    if (!status.configured) return { status: 'NOT_CONFIGURED', error: 'Missing credentials' };

    const res = await this.gtmRepo.createVersionDraft(workspacePath, name, notes);
    if (!res.success) return { status: 'PROVIDER_ERROR', error: res.error };

    return { status: 'VERSION_DRAFT_CREATED', data: res.data };
  }
}
