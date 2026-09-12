import { FULL_ACCESS_ROLES, PLATFORM_ADMINISTRATOR_ROLE } from '@goldplus/shared';

/**
 * Governed admin-user creation and role assignment (§6 completion).
 *
 * Rules enforced HERE:
 *  - passwords: >= 12 chars, not containing the email local part (initial password
 *    is communicated out-of-band by the creating administrator and should be
 *    rotated on first login — every session issued before a password change is
 *    already hard-revoked by the existing cutoff mechanism);
 *  - PLATFORM_ADMINISTRATOR is NEVER granted directly: a grant becomes a PENDING
 *    request that a DIFFERENT administrator must approve (maker/checker) — the
 *    requester deciding their own request is refused;
 *  - lockout guard: an administrator cannot revoke their own PLATFORM_ADMINISTRATOR;
 *  - only the governance vocabulary is assignable.
 */

export interface IAdminUserWriteRepository {
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  createUser(input: { email: string; phone: string | null; passwordHash: string }): Promise<{ id: string; email: string }>;
  /** Any role that exists — the governance vocabulary plus roles created in the Back Office. */
  roleExists(roleName: string): Promise<boolean>;
  assignRole(userId: string, roleName: string): Promise<boolean>; // false = role unknown
  revokeRole(userId: string, roleName: string): Promise<boolean>;
  userHasRole(userId: string, roleName: string): Promise<boolean>;
  createGrantRequest(input: { userId: string; roleName: string; requestedBy: string; reason: string | null }): Promise<{ id: string } | null>; // null = duplicate pending
  findGrantRequest(id: string): Promise<{ id: string; userId: string; roleName: string; status: string; requestedBy: string } | null>;
  decideGrantRequest(id: string, fields: { status: 'APPROVED' | 'REJECTED'; decidedBy: string; reason: string | null }): Promise<void>;
  /** Active users currently holding the role — the platform's remaining full administrators when asked for PLATFORM_ADMINISTRATOR. */
  countActiveUsersWithRole(roleName: string): Promise<number>;
  findUserById(id: string): Promise<{ id: string; isActive: boolean } | null>;
  /** false = user unknown. */
  setUserActive(userId: string, active: boolean): Promise<boolean>;
  listGrantRequests(): Promise<Array<{ id: string; userId: string; roleName: string; status: string; requestedBy: string; requestedAt: Date }>>;
}

export interface PasswordHasherPort {
  hash(plaintext: string): Promise<string>;
}

export type UmOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; status: number };
const refuse = (code: string, message: string, status = 400): UmOutcome<never> => ({ ok: false, code, message, status });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Live sessions of a deactivated account must die with it; the auth middleware does not re-read is_active per request. */
export interface SessionInvalidatorPort {
  invalidateSessionsAfter(userId: string, at: Date): Promise<void>;
}

export class AdminUserManagementUseCase {
  constructor(
    private readonly repo: IAdminUserWriteRepository,
    private readonly hasher: PasswordHasherPort,
    /** Optional so existing callers/tests construct unchanged. */
    private readonly sessions?: SessionInvalidatorPort,
  ) {}

  async createUser(args: {
    email: string;
    phone?: string | null;
    initialPassword: string;
    roleName: string;
    actorId: string;
  }): Promise<UmOutcome<{ userId: string; email: string; roleOutcome: 'ASSIGNED' | 'PENDING_APPROVAL' }>> {
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return refuse('BAD_EMAIL', 'A valid email address is required.');
    if (!(await this.repo.roleExists(args.roleName))) {
      return refuse('UNKNOWN_ROLE', `No role named ${args.roleName} exists. Roles are managed in the Back Office.`);
    }
    const password = args.initialPassword;
    if (typeof password !== 'string' || password.length < 12) {
      return refuse('WEAK_PASSWORD', 'Initial password must be at least 12 characters.');
    }
    const localPart = email.split('@')[0];
    if (localPart.length >= 4 && password.toLowerCase().includes(localPart.toLowerCase())) {
      return refuse('WEAK_PASSWORD', 'Initial password must not contain the email name.');
    }
    if (await this.repo.findUserByEmail(email)) {
      return refuse('DUPLICATE_EMAIL', 'A user with this email already exists.', 409);
    }

    const passwordHash = await this.hasher.hash(password);
    const user = await this.repo.createUser({ email, phone: args.phone?.trim() || null, passwordHash });

    if ((FULL_ACCESS_ROLES as readonly string[]).includes(args.roleName)) {
      // Never direct — the two-person rule starts at creation time.
      await this.repo.createGrantRequest({ userId: user.id, roleName: args.roleName, requestedBy: args.actorId, reason: 'Requested at user creation' });
      return { ok: true, value: { userId: user.id, email: user.email, roleOutcome: 'PENDING_APPROVAL' } };
    }
    const assigned = await this.repo.assignRole(user.id, args.roleName);
    if (!assigned) return refuse('UNKNOWN_ROLE', 'Role rows missing — boot sync has not run.', 500);
    return { ok: true, value: { userId: user.id, email: user.email, roleOutcome: 'ASSIGNED' } };
  }

  async grantRole(args: { userId: string; roleName: string; actorId: string; reason?: string | null }): Promise<UmOutcome<{ outcome: 'ASSIGNED' | 'PENDING_APPROVAL' }>> {
    if (!(await this.repo.roleExists(args.roleName))) {
      return refuse('UNKNOWN_ROLE', `No role named ${args.roleName} exists. Roles are managed in the Back Office.`);
    }
    if ((FULL_ACCESS_ROLES as readonly string[]).includes(args.roleName)) {
      // Both full-access roles go through the two-person rule.
      const request = await this.repo.createGrantRequest({ userId: args.userId, roleName: args.roleName, requestedBy: args.actorId, reason: args.reason ?? null });
      if (!request) return refuse('DUPLICATE_PENDING', 'A pending request for this grant already exists.', 409);
      return { ok: true, value: { outcome: 'PENDING_APPROVAL' } };
    }
    const assigned = await this.repo.assignRole(args.userId, args.roleName);
    if (!assigned) return refuse('UNKNOWN_ROLE', 'Role rows missing — boot sync has not run.', 500);
    return { ok: true, value: { outcome: 'ASSIGNED' } };
  }

  async decideGrant(args: { requestId: string; decision: 'APPROVED' | 'REJECTED'; actorId: string; reason?: string | null }): Promise<UmOutcome<{ decided: string }>> {
    const request = await this.repo.findGrantRequest(args.requestId);
    if (!request) return refuse('NOT_FOUND', 'Grant request not found.', 404);
    if (request.status !== 'PENDING') return refuse('ALREADY_DECIDED', `Request is already ${request.status}.`, 409);
    if (request.requestedBy === args.actorId) {
      return refuse('MAKER_CHECKER', 'The requester cannot decide their own grant. A different administrator must approve.', 403);
    }
    if (request.userId === args.actorId) {
      return refuse('MAKER_CHECKER', 'The person receiving the role cannot decide their own grant.', 403);
    }
    await this.repo.decideGrantRequest(args.requestId, { status: args.decision, decidedBy: args.actorId, reason: args.reason ?? null });
    if (args.decision === 'APPROVED') {
      await this.repo.assignRole(request.userId, request.roleName);
    }
    return { ok: true, value: { decided: args.decision } };
  }

  async revokeRole(args: { userId: string; roleName: string; actorId: string }): Promise<UmOutcome<{ revoked: boolean }>> {
    if (args.roleName === PLATFORM_ADMINISTRATOR_ROLE && args.userId === args.actorId) {
      // Lockout guard: removing your own full-admin role can strand the platform.
      return refuse('SELF_LOCKOUT', 'You cannot revoke your own PLATFORM_ADMINISTRATOR role.', 403);
    }
    if (args.roleName === PLATFORM_ADMINISTRATOR_ROLE) {
      // Platform guard (pre-live audit, 2026-09-12): the self check above did not
      // stop ANOTHER administrator from stripping the last remaining full admin,
      // leaving nobody able to manage access. Refuse if the target is an active
      // holder and no other active holder would remain.
      const target = await this.repo.findUserById(args.userId);
      const holds = await this.repo.userHasRole(args.userId, PLATFORM_ADMINISTRATOR_ROLE);
      if (target?.isActive && holds && (await this.repo.countActiveUsersWithRole(PLATFORM_ADMINISTRATOR_ROLE)) <= 1) {
        return refuse('LAST_ADMIN', 'This is the last active PLATFORM_ADMINISTRATOR. Grant the role to someone else before revoking it.', 409);
      }
    }
    const revoked = await this.repo.revokeRole(args.userId, args.roleName);
    return { ok: true, value: { revoked } };
  }

  /**
   * Deactivate / reactivate an account. users.is_active existed and login
   * honoured it, but nothing let an operator set it — a departed staff member
   * could not be disabled from the Back Office. Guards: never yourself; never
   * the last active full administrator; a deactivation needs a reason and
   * ends the account's live sessions.
   */
  async setActive(args: { userId: string; active: boolean; actorId: string; reason?: string | null }): Promise<UmOutcome<{ changed: boolean; active: boolean }>> {
    if (!args.active && args.userId === args.actorId) {
      return refuse('SELF_LOCKOUT', 'You cannot deactivate your own account.', 403);
    }
    const target = await this.repo.findUserById(args.userId);
    if (!target) return refuse('NOT_FOUND', 'User not found.', 404);
    if (!args.active) {
      if ((args.reason ?? '').trim().length < 5) return refuse('REASON_REQUIRED', 'Give a reason for deactivating this account (at least 5 characters).');
      const holds = await this.repo.userHasRole(args.userId, PLATFORM_ADMINISTRATOR_ROLE);
      if (target.isActive && holds && (await this.repo.countActiveUsersWithRole(PLATFORM_ADMINISTRATOR_ROLE)) <= 1) {
        return refuse('LAST_ADMIN', 'This is the last active PLATFORM_ADMINISTRATOR and cannot be deactivated.', 409);
      }
    }
    if (target.isActive === args.active) return { ok: true, value: { changed: false, active: args.active } };
    await this.repo.setUserActive(args.userId, args.active);
    if (!args.active) await this.sessions?.invalidateSessionsAfter(args.userId, new Date());
    return { ok: true, value: { changed: true, active: args.active } };
  }

  /** The REQUESTER may withdraw their own PENDING request (withdraw ≠ decide). */
  async withdrawGrant(args: { requestId: string; actorId: string }): Promise<UmOutcome<{ withdrawn: true }>> {
    const request = await this.repo.findGrantRequest(args.requestId);
    if (!request) return refuse('NOT_FOUND', 'Grant request not found.', 404);
    if (request.status !== 'PENDING') return refuse('ALREADY_DECIDED', `Request is already ${request.status}.`, 409);
    if (request.requestedBy !== args.actorId) {
      return refuse('NOT_REQUESTER', 'Only the requester may withdraw their own request.', 403);
    }
    await this.repo.decideGrantRequest(args.requestId, { status: 'REJECTED', decidedBy: args.actorId, reason: 'WITHDRAWN_BY_REQUESTER' });
    return { ok: true, value: { withdrawn: true } };
  }

}
