export interface GtmRepository {
  getCredentialStatus(): Promise<{ configured: boolean; missingVariables: string[] }>;
  getContainerStatus(containerPath: string): Promise<{ success: boolean; data?: any; error?: string }>;
  listAccounts(): Promise<{ success: boolean; data?: any[]; error?: string }>;
  listContainers(accountPath: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  listWorkspaces(containerPath: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  getWorkspace(workspacePath: string): Promise<{ success: boolean; data?: any; error?: string }>;
  createWorkspace(containerPath: string, name: string): Promise<{ success: boolean; data?: any; error?: string }>;
  listTags(workspacePath: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  listTriggers(workspacePath: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  listVariables(workspacePath: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  createTag(workspacePath: string, tag: any): Promise<{ success: boolean; data?: any; error?: string }>;
  createTrigger(workspacePath: string, trigger: any): Promise<{ success: boolean; data?: any; error?: string }>;
  createVariable(workspacePath: string, variable: any): Promise<{ success: boolean; data?: any; error?: string }>;
  createVersionDraft(workspacePath: string, name: string, notes?: string): Promise<{ success: boolean; data?: any; error?: string }>;
}
