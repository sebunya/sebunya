import { FULL_ACCESS_ROLES, PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_NAME_PATTERN } from '@goldplus/shared';
import type { AdminRoleDetail, IAdminRoleWriteRepository } from '../../ports/IAdminRoleWriteRepository';

/**
 * Role management (2026-09-12): create a role, set exactly which permissions
 * it carries, delete a role nobody holds.
 *
 * Rules enforced HERE:
 *  - the two full-access roles (PLATFORM_ADMINISTRATOR, Owner) are SYSTEM
 *    roles: never edited, never deleted, never created twice;
 *  - a permission code must be one the code registry defines — a role can
 *    only ever grant something a route actually checks;
 *  - lockout guard: removing auth.manage or roles.manage from a role is
 *    refused when no ACTIVE user would still hold that code through another
 *    role — otherwise one save could lock every operator out of access
 *    management;
 *  - a role held by anyone cannot be deleted; revoke it from them first.
 */
export type RmOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; status: number };
const refuse = (code: string, message: string, status = 400): RmOutcome<never> => ({ ok: false, code, message, status });

export const ACCESS_MANAGEMENT_CODES: readonly string[] = [PERMISSIONS.AUTH_MANAGE, PERMISSIONS.ROLES_MANAGE];

export interface PermissionCatalogueEntry {
  code: string;
  /** First segment of the code: the module it belongs to. */
  area: string;
}

export class RoleManagementUseCase {
  private readonly registry = new Set<string>(Object.values(PERMISSIONS));

  constructor(private readonly repo: IAdminRoleWriteRepository) {}

  /** Every code a role may carry, grouped by module. Pure: the registry in code is the catalogue. */
  catalogue(): PermissionCatalogueEntry[] {
    return Array.from(this.registry)
      .sort()
      .map((code) => ({ code, area: code.slice(0, code.indexOf('.')) }));
  }

  describe(roleName: string): string | null {
    return ROLE_DESCRIPTIONS[roleName] ?? null;
  }

  isSystemRole(roleName: string): boolean {
    return (FULL_ACCESS_ROLES as readonly string[]).includes(roleName);
  }

  async createRole(args: { name: string; permissionCodes: string[]; actorId: string }): Promise<RmOutcome<{ id: string; name: string; permissionCodes: string[] }>> {
    const name = args.name.trim();
    if (!ROLE_NAME_PATTERN.test(name)) {
      return refuse('BAD_NAME', 'A role name is 3 to 50 characters of capitals, digits and underscores, starting with a letter (for example SUPPORT_LEAD).');
    }
    if (this.isSystemRole(name)) return refuse('SYSTEM_ROLE', `${name} is a system role and already exists.`, 409);
    if (await this.repo.findRoleByName(name)) return refuse('DUPLICATE', `A role named ${name} already exists.`, 409);
    const codes = this.normaliseCodes(args.permissionCodes);
    if (!codes.ok) return codes;
    const created = await this.repo.createRole(name, codes.value);
    return { ok: true, value: { id: created.id, name, permissionCodes: codes.value } };
  }

  async replacePermissions(args: { roleId: string; permissionCodes: string[]; actorId: string }): Promise<RmOutcome<{ role: AdminRoleDetail; previousCodes: string[]; nextCodes: string[] }>> {
    const role = await this.repo.findRoleById(args.roleId);
    if (!role) return refuse('NOT_FOUND', 'Role not found.', 404);
    if (this.isSystemRole(role.name)) {
      return refuse('SYSTEM_ROLE', `${role.name} always carries every permission and cannot be edited.`, 409);
    }
    const codes = this.normaliseCodes(args.permissionCodes);
    if (!codes.ok) return codes;
    const previousCodes = [...role.permissionCodes];
    const next = new Set(codes.value);
    for (const guarded of ACCESS_MANAGEMENT_CODES) {
      if (previousCodes.includes(guarded) && !next.has(guarded)) {
        const others = await this.repo.countActiveUsersWithPermissionOutsideRole(guarded, role.id);
        if (others === 0) {
          return refuse(
            'LAST_ACCESS_MANAGER',
            `Removing ${guarded} from ${role.name} would leave no active administrator able to manage access. Grant it through another role first.`,
            409,
          );
        }
      }
    }
    await this.repo.replacePermissions(role.id, codes.value);
    return { ok: true, value: { role: { ...role, permissionCodes: previousCodes }, previousCodes, nextCodes: codes.value } };
  }

  async deleteRole(args: { roleId: string; actorId: string }): Promise<RmOutcome<{ role: AdminRoleDetail }>> {
    const role = await this.repo.findRoleById(args.roleId);
    if (!role) return refuse('NOT_FOUND', 'Role not found.', 404);
    if (this.isSystemRole(role.name)) return refuse('SYSTEM_ROLE', `${role.name} is a system role and cannot be deleted.`, 409);
    if (role.userCount > 0) {
      return refuse('ROLE_IN_USE', `${role.name} is held by ${role.userCount} account${role.userCount === 1 ? '' : 's'}. Revoke it from them first.`, 409);
    }
    await this.repo.deleteRole(role.id);
    return { ok: true, value: { role } };
  }

  private normaliseCodes(input: string[]): RmOutcome<string[]> {
    if (!Array.isArray(input)) return refuse('BAD_INPUT', 'permissionCodes must be a list of permission codes.');
    const unique = Array.from(new Set(input.map((c) => String(c).trim()).filter(Boolean))).sort();
    const unknown = unique.filter((c) => !this.registry.has(c));
    if (unknown.length > 0) {
      return refuse('UNKNOWN_PERMISSION', `Not a permission any route checks: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}.`);
    }
    return { ok: true, value: unique };
  }
}
