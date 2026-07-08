import { GtmRepository } from '../../application/ports/measurement/GtmRepository';
import { GtmCredentialRedactor } from './GtmCredentialRedactor';

export class GoogleTagManagerRepository implements GtmRepository {
  private redactor = new GtmCredentialRedactor();

  async getCredentialStatus(): Promise<{ configured: boolean; missingVariables: string[] }> {
    const missing = [];
    if (!process.env.GTM_API_CLIENT_SECRET) missing.push('GTM_API_CLIENT_SECRET');
    if (!process.env.GTM_API_REFRESH_TOKEN) missing.push('GTM_API_REFRESH_TOKEN');
    return {
      configured: missing.length === 0,
      missingVariables: missing
    };
  }

  private requireCredentials() {
    if (!process.env.GTM_API_CLIENT_SECRET || !process.env.GTM_API_REFRESH_TOKEN) {
      throw new Error('PROVIDER_ERROR: Credentials not configured');
    }
  }

  async getContainerStatus(containerPath: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: { status: 'mock_active' } };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async listAccounts(): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: [] };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async listContainers(accountPath: string): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: [] };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async listWorkspaces(containerPath: string): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: [] };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async getWorkspace(workspacePath: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: { name: 'Workspace' } };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async createWorkspace(containerPath: string, name: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: { name, path: `${containerPath}/workspaces/123` } };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async listTags(workspacePath: string): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: [] };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async listTriggers(workspacePath: string): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: [] };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async listVariables(workspacePath: string): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: [] };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async createTag(workspacePath: string, tag: any): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: tag };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async createTrigger(workspacePath: string, trigger: any): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: trigger };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async createVariable(workspacePath: string, variable: any): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: variable };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }

  async createVersionDraft(workspacePath: string, name: string, notes?: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.requireCredentials();
      return { success: true, data: { name, notes } };
    } catch (e: any) {
      return { success: false, error: this.redactor.redact(e.message) };
    }
  }
}
