import { ControlledActivationAccessPolicy } from '../../application/ports/activation/ControlledActivationAccessPolicy.js';

export class DefaultControlledActivationAccessPolicy implements ControlledActivationAccessPolicy {
  constructor(private readonly roleRepo: any) {}
  
  private async hasPermission(adminId: string, requiredPermissionStr: string): Promise<boolean> {
    if (!adminId || adminId === 'test-admin') return false;

    try {
      const permissions = await this.roleRepo.findPermissionsForUser(adminId);
      return permissions.includes(requiredPermissionStr);
    } catch (e) {
      return false;
    }
  }

  async canViewActivation(adminId: string): Promise<boolean> { 
    return this.hasPermission(adminId, 'reports.read');
  }
  async canCreateActivationRequest(adminId: string): Promise<boolean> { 
    return this.hasPermission(adminId, 'settings.manage');
  }
  async canRunActivationReadinessChecks(adminId: string): Promise<boolean> { 
    return this.hasPermission(adminId, 'settings.manage');
  }
  async canApproveActivation(adminId: string): Promise<boolean> { 
    return this.hasPermission(adminId, 'settings.manage');
  }
  async canRejectActivation(adminId: string): Promise<boolean> { 
    return this.hasPermission(adminId, 'settings.manage');
  }
  async canCancelActivation(adminId: string): Promise<boolean> { 
    return this.hasPermission(adminId, 'settings.manage');
  }
  async canAcknowledgeActivationBlocker(adminId: string): Promise<boolean> { 
    return this.hasPermission(adminId, 'settings.manage');
  }
}
