/**
 * Separation of duties for controlled activation (§6.5, §10.3). Pure domain.
 *
 * A controlled activation moves the live platform, so the person who REQUESTED
 * it must not also be the one who APPROVES it — two-person integrity. The
 * approval path recorded the approver but never checked this, so a maker could
 * rubber-stamp their own change. This rule closes that: self-approval is denied,
 * and a missing approver is denied.
 */

export type ApprovalAuthorization = { allowed: true } | { allowed: false; reason: string };

export function authorizeActivationApproval(
  requestedByAdminId: string | null | undefined,
  approverAdminId: string | null | undefined,
): ApprovalAuthorization {
  if (!approverAdminId) {
    return { allowed: false, reason: 'An approver is required.' };
  }
  if (requestedByAdminId && approverAdminId === requestedByAdminId) {
    return {
      allowed: false,
      reason: 'Separation of duties: the admin who requested this activation cannot approve it. A second approver is required.',
    };
  }
  return { allowed: true };
}
