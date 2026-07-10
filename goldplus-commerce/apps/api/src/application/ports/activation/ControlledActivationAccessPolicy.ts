export interface ControlledActivationAccessPolicy {
  canViewActivation(adminId: string): Promise<boolean>;
  canCreateActivationRequest(adminId: string): Promise<boolean>;
  canRunActivationReadinessChecks(adminId: string): Promise<boolean>;
  canApproveActivation(adminId: string): Promise<boolean>;
  canRejectActivation(adminId: string): Promise<boolean>;
  canCancelActivation(adminId: string): Promise<boolean>;
  canAcknowledgeActivationBlocker(adminId: string): Promise<boolean>;
}
