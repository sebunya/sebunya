import { IReleaseReadinessAccessPolicy } from '../../application/ports/release/ReleaseReadinessAccessPolicy';

export class DefaultReleaseReadinessAccessPolicy implements IReleaseReadinessAccessPolicy {
  canViewReleaseReadiness(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes('RELEASE_READINESS_READ') || permissions.includes('SYSTEM_ADMIN');
  }

  canRunReleaseChecks(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes('RELEASE_READINESS_RUN') || permissions.includes('SYSTEM_ADMIN');
  }

  canRecordReleaseDecision(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes('RELEASE_DECISION_WRITE') || permissions.includes('SYSTEM_ADMIN');
  }

  canAcknowledgeGate(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes('RELEASE_GATE_ACKNOWLEDGE') || permissions.includes('SYSTEM_ADMIN');
  }
}
