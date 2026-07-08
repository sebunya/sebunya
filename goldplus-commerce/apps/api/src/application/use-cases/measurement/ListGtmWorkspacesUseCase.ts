import { GtmRepository } from '../../ports/measurement/GtmRepository';

export class ListGtmWorkspacesUseCase {
  constructor(private readonly gtmRepository: GtmRepository) {}

  async execute(containerPath: string) {
    return await this.gtmRepository.listWorkspaces(containerPath);
  }
}
