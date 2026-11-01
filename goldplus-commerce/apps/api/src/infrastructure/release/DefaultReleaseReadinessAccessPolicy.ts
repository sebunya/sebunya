import { PERMISSIONS } from '@goldplus/shared';
import { IReleaseReadinessAccessPolicy } from '../../application/ports/release/ReleaseReadinessAccessPolicy';

/**
 * Maps release-readiness capabilities onto the REAL permission vocabulary.
 *
 * The original policy checked phantom strings (RELEASE_READINESS_READ,
 * SYSTEM_ADMIN, …) that exist in no permissions table, so every capability was
 * structurally false for every account — the module could never be used.
 * reports.read is the read bar; settings.manage is the bar for the mutating
 * release verbs, consistent with the controlled-activation access policy.
 */
export class DefaultReleaseReadinessAccessPolicy implements IReleaseReadinessAccessPolicy {
  canViewReleaseReadiness(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.REPORTS_READ);
  }

  canRunReleaseChecks(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.SETTINGS_MANAGE);
  }

  canRecordReleaseDecision(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.SETTINGS_MANAGE);
  }

  canAcknowledgeGate(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.SETTINGS_MANAGE);
  }
}
