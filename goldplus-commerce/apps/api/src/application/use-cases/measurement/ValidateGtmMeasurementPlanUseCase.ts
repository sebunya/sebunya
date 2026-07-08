import { GtmPlanBuilder } from '../../services/measurement/GtmPlanBuilder';
import { GtmDiffService } from '../../services/measurement/GtmDiffService';
import { GtmRepository } from '../../ports/measurement/GtmRepository';

export class ValidateGtmMeasurementPlanUseCase {
  constructor(
    private readonly gtmRepo: GtmRepository,
    private readonly planBuilder: GtmPlanBuilder,
    private readonly diffService: GtmDiffService
  ) {}

  async execute(containerPath: string, containerType: 'web' | 'server') {
    const status = await this.gtmRepo.getCredentialStatus();
    if (!status.configured) return { status: 'NOT_CONFIGURED', error: 'Missing credentials' };

    const workspaceRes = await this.gtmRepo.listWorkspaces(containerPath);
    if (!workspaceRes.success) return { status: 'PROVIDER_ERROR', error: workspaceRes.error };
    
    // Pick first workspace as default mock validation
    const workspace = workspaceRes.data?.[0];
    if (!workspace) return { status: 'VALIDATION_FAILED', error: 'No workspace found' };

    const existingTags = await this.gtmRepo.listTags(workspace.path);
    if (!existingTags.success) return { status: 'PROVIDER_ERROR', error: existingTags.error };

    const plan = this.planBuilder.buildGoldPlusPlan(containerType);
    const diff = this.diffService.computeDiff(plan, existingTags.data || []);

    if (diff.duplicateAssetNames.length > 0) {
      return { status: 'DUPLICATE_ASSETS_FOUND', data: diff };
    }
    if (diff.unsafePublishFound) {
      return { status: 'UNSAFE_CHANGE_DETECTED', data: diff };
    }

    return { status: 'OK', data: diff };
  }
}
