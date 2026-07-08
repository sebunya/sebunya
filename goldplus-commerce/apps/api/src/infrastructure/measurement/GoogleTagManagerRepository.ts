import { GtmRepository, GtmWorkspace, GtmVersionDraft } from '../../application/ports/measurement/GtmRepository';

export class GoogleTagManagerRepository implements GtmRepository {
  async listWorkspaces(containerPath: string): Promise<GtmWorkspace[]> {
    return [
      {
        workspaceId: 'workspace-123',
        name: 'Default Workspace',
        fingerprint: '1234567890',
      }
    ];
  }

  async createWorkspace(containerPath: string, name: string): Promise<GtmWorkspace> {
    return {
      workspaceId: 'workspace-new',
      name,
      fingerprint: 'abcdef',
    };
  }

  async createVersionDraft(workspacePath: string, name: string): Promise<GtmVersionDraft> {
    return {
      versionId: 'version-new',
      name,
      fingerprint: 'fedcba',
    };
  }

  async syncChanges(workspacePath: string, changes: any): Promise<void> {
    // Simulated sync
    return Promise.resolve();
  }
}
