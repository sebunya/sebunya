import { IUserRepository } from '../../ports/IUserRepository';
import { IUserCredentialsRepository } from '../../ports/IUserAdminRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { validatePassword } from '../../../domain/identity/PasswordPolicy';

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'WRONG_PASSWORD' | 'BAD_PASSWORD' | 'SAME_PASSWORD'; message: string };

export class ChangePasswordUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly credentials: IUserCredentialsRepository,
    private readonly hasher: IPasswordHasher
  ) {}

  async execute(input: { userId: string; currentPassword: string; newPassword: string }): Promise<ChangePasswordResult> {
    const user = await this.users.findById(input.userId);
    if (!user) return { ok: false, code: 'NOT_FOUND', message: 'User not found.' };

    const currentOk = await this.hasher.verify(input.currentPassword ?? '', user.passwordHash);
    if (!currentOk) return { ok: false, code: 'WRONG_PASSWORD', message: 'Current password is incorrect.' };

    const policy = validatePassword(input.newPassword ?? '');
    if (!policy.ok) return { ok: false, code: 'BAD_PASSWORD', message: policy.message };

    if (input.newPassword === input.currentPassword) {
      return { ok: false, code: 'SAME_PASSWORD', message: 'New password must differ from the current password.' };
    }

    const newHash = await this.hasher.hash(input.newPassword);
    const updated = await this.credentials.updatePasswordHash(user.id, newHash);
    if (!updated) return { ok: false, code: 'NOT_FOUND', message: 'User disappeared during update.' };
    return { ok: true };
  }
}
