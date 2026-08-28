import { GOVERNANCE_ROLES, PLATFORM_ADMINISTRATOR_ROLE } from '@goldplus/shared';

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
  assignRole(userId: string, roleName: string): Promise<boolean>; // false = role unknown
  revokeRole(userId: string, roleName: string): Promise<boolean>;
  userHasRole(userId: string, roleName: string): Promise<boolean>;
  createGrantRequest(input: { userId: string; roleName: string; requestedBy: string; reason: string | null }): Promise<{ id: string } | null>; // null = duplicate pending
  findGrantRequest(id: string): Promise<{ id: string; userId: string; roleName: string; status: string; requestedBy: string } | null>;
  decideGrantRequest(id: string, fields: { status: 'APPROVED' | 'REJECTED'; decidedBy: string; reason: string | null }): Promise<void>;
  listGrantRequests(): Promise<Array<{ id: string; userId: string; roleName: string; status: string; requestedBy: string; requestedAt: Date }>>;
}

export interface PasswordHasherPort {
  hash(plaintext: string): Promise<string>;
}

export type UmOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; status: number };
const refuse = (code: string, message: string, status = 400): UmOutcome<never> => ({ ok: false, code, message, status });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AdminUserManagementUseCase {
  constructor(private readonly repo: IAdminUserWriteRepository, private readonly hasher: PasswordHasherPort) {}

  async createUser(args: {
    email: string;
    phone?: string | null;
    initialPassword: string;
    roleName: string;
    actorId: string;
  }): Promise<UmOutcome<{ userId: string; email: string; roleOutcome: 'ASSIGNED' | 'PENDING_APPROVAL' }>> {
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return refuse('BAD_EMAIL', 'A valid email address is required.');
    if (!(GOVERNANCE_ROLES as readonly string[]).includes(args.roleName)) {
      return refuse('UNKNOWN_ROLE', `roleName must be one of the governance vocabulary: ${GOVERNANCE_ROLES.join(', ')}`);
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

    if (args.roleName === PLATFORM_ADMINISTRATOR_ROLE) {
      // Never direct — the two-person rule starts at creation time.
      await this.repo.createGrantRequest({ userId: user.id, roleName: args.roleName, requestedBy: args.actorId, reason: 'Requested at user creation' });
      return { ok: true, value: { userId: user.id, email: user.email, roleOutcome: 'PENDING_APPROVAL' } };
    }
    const assigned = await this.repo.assignRole(user.id, args.roleName);
    if (!assigned) return refuse('UNKNOWN_ROLE', 'Role rows missing — boot sync has not run.', 500);
    return { ok: true, value: { userId: user.id, email: user.email, roleOutcome: 'ASSIGNED' } };
  }

  async grantRole(args: { userId: string; roleName: string; actorId: string; reason?: string | null }): Promise<UmOutcome<{ outcome: 'ASSIGNED' | 'PENDING_APPROVAL' }>> {
    if (!(GOVERNANCE_ROLES as readonly string[]).includes(args.roleName)) {
      return refuse('UNKNOWN_ROLE', `roleName must be one of: ${GOVERNANCE_ROLES.join(', ')}`);
    }
    if (args.roleName === PLATFORM_ADMINISTRATOR_ROLE) {
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
    const revoked = await this.repo.revokeRole(args.userId, args.roleName);
    return { ok: true, value: { revoked } };
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
