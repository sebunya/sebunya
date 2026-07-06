import { IUserAdminRepository } from '../../ports/IUserAdminRepository';

export type SetUserActiveResult =
  | { ok: true; userId: string; isActive: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'SELF_LOCKOUT'; message: string };

export class SetUserActiveUseCase {
  constructor(private readonly userAdmin: IUserAdminRepository) {}

  async execute(input: { actorId: string; userId: string; isActive: boolean }): Promise<SetUserActiveResult> {
    if (!input.isActive && input.actorId === input.userId) {
      return { ok: false, code: 'SELF_LOCKOUT', message: 'You cannot deactivate your own account.' };
    }
    const user = await this.userAdmin.setActive(input.userId, input.isActive);
    if (!user) return { ok: false, code: 'NOT_FOUND', message: 'User not found.' };
    return { ok: true, userId: user.id, isActive: user.isActive };
  }
}

export type ChangeUserRoleResult =
  | { ok: true; outcome: 'OK' | 'ALREADY_ASSIGNED' | 'NOT_ASSIGNED' }
  | { ok: false; code: 'NOT_FOUND' | 'ROLE_NOT_FOUND' | 'SELF_CHANGE'; message: string };

export class AssignUserRoleUseCase {
  constructor(private readonly userAdmin: IUserAdminRepository) {}

  async execute(input: { actorId: string; userId: string; roleId: string }): Promise<ChangeUserRoleResult> {
    if (input.actorId === input.userId) {
      return { ok: false, code: 'SELF_CHANGE', message: 'You cannot change your own roles.' };
    }
    const outcome = await this.userAdmin.assignRole(input.userId, input.roleId);
    if (outcome === 'USER_NOT_FOUND') return { ok: false, code: 'NOT_FOUND', message: 'User not found.' };
    if (outcome === 'ROLE_NOT_FOUND') return { ok: false, code: 'ROLE_NOT_FOUND', message: 'Role not found.' };
    return { ok: true, outcome: outcome === 'ALREADY_ASSIGNED' ? 'ALREADY_ASSIGNED' : 'OK' };
  }
}

export class RemoveUserRoleUseCase {
  constructor(private readonly userAdmin: IUserAdminRepository) {}

  async execute(input: { actorId: string; userId: string; roleId: string }): Promise<ChangeUserRoleResult> {
    if (input.actorId === input.userId) {
      return { ok: false, code: 'SELF_CHANGE', message: 'You cannot change your own roles.' };
    }
    const outcome = await this.userAdmin.removeRole(input.userId, input.roleId);
    if (outcome === 'USER_NOT_FOUND') return { ok: false, code: 'NOT_FOUND', message: 'User not found.' };
    if (outcome === 'ROLE_NOT_FOUND') return { ok: false, code: 'ROLE_NOT_FOUND', message: 'Role not found.' };
    return { ok: true, outcome: outcome === 'NOT_ASSIGNED' ? 'NOT_ASSIGNED' : 'OK' };
  }
}
