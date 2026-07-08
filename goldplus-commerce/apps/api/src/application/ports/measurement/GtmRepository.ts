export interface GtmWorkspace {
  workspaceId: string;
  name: string;
  fingerprint: string;
}

export interface GtmVersionDraft {
  versionId: string;
  name: string;
  fingerprint: string;
}

export interface GtmRepository {
  listWorkspaces(containerPath: string): Promise<GtmWorkspace[]>;
  createWorkspace(containerPath: string, name: string): Promise<GtmWorkspace>;
  createVersionDraft(workspacePath: string, name: string): Promise<GtmVersionDraft>;
  syncChanges(workspacePath: string, changes: any): Promise<void>;
}
