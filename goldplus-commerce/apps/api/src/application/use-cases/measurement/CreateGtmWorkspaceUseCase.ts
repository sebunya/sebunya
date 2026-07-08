import { GtmRepository } from '../../ports/measurement/GtmRepository';

export class CreateGtmWorkspaceUseCase {
  constructor(private readonly gtmRepo: GtmRepository) {}

  async execute(containerPath: string, name: string) {
    const status = await this.gtmRepo.getCredentialStatus();
    if (!status.configured) return { status: 'NOT_CONFIGURED', error: 'Missing credentials' };

    const res = await this.gtmRepo.createWorkspace(containerPath, name);
    if (!res.success) return { status: 'PROVIDER_ERROR', error: res.error };

    return { status: 'WORKSPACE_CREATED', data: res.data };
  }
}
