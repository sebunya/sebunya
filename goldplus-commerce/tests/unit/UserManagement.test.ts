import { describe, expect, it } from 'vitest';
import { validatePassword, isValidEmail } from '../../apps/api/src/domain/identity/PasswordPolicy';
import { RegisterUserUseCase } from '../../apps/api/src/application/use-cases/identity/RegisterUserUseCase';
import { ChangePasswordUseCase } from '../../apps/api/src/application/use-cases/identity/ChangePasswordUseCase';
import {
  SetUserActiveUseCase,
  AssignUserRoleUseCase,
  RemoveUserRoleUseCase,
} from '../../apps/api/src/application/use-cases/admin/ManageUserAccountUseCases';
import { IUserRepository, PersistedUser } from '../../apps/api/src/application/ports/IUserRepository';
import { IPasswordHasher } from '../../apps/api/src/application/ports/IPasswordHasher';
import { ITokenSigner } from '../../apps/api/src/application/ports/ITokenSigner';
import { IOutboxWriter } from '../../apps/api/src/application/ports/IOutboxWriter';
import {
  IUserAdminRepository,
  IUserCredentialsRepository,
  RoleAssignmentOutcome,
} from '../../apps/api/src/application/ports/IUserAdminRepository';

class InMemoryUsers implements IUserRepository {
  public users: PersistedUser[] = [];
  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async create(input: { email: string; phone: string | null; passwordHash: string }) {
    const user: PersistedUser = {
      id: `user-${this.users.length + 1}`,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      isActive: true,
      createdAt: new Date(),
    };
    this.users.push(user);
    return user;
  }
}

const fakeHasher: IPasswordHasher = {
  async hash(p: string) {
    return `hashed:${p}`;
  },
  async verify(p: string, stored: string) {
    return stored === `hashed:${p}`;
  },
};

function makeSigner(configured = true): ITokenSigner {
  return {
    isConfigured: () => configured,
    async sign() {
      return 'token-abc';
    },
    async verify() {
      return null;
    },
  };
}

class CapturingOutbox implements IOutboxWriter {
  public events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  async append(eventType: string, payload: Record<string, unknown>) {
    this.events.push({ type: eventType, payload });
  }
}

describe('password policy', () => {
  it('requires 8+ chars with a letter and a digit', () => {
    expect(validatePassword('short1').ok).toBe(false);
    expect(validatePassword('allletters').ok).toBe(false);
    expect(validatePassword('12345678').ok).toBe(false);
    expect(validatePassword('goodpass1').ok).toBe(true);
  });

  it('validates email shape', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
});

describe('RegisterUserUseCase', () => {
  it('registers, enqueues a welcome email, and blocks duplicates', async () => {
    const users = new InMemoryUsers();
    const outbox = new CapturingOutbox();
    const uc = new RegisterUserUseCase(users, fakeHasher, makeSigner(), outbox);

    const first = await uc.execute({ email: 'New@Example.com', password: 'goodpass1' });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.user.email).toBe('new@example.com');
    expect(outbox.events).toHaveLength(1);
    expect(outbox.events[0].type).toBe('USER_REGISTERED');

    const dup = await uc.execute({ email: 'new@example.com', password: 'goodpass1' });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('EMAIL_TAKEN');
  });

  it('rejects weak passwords and bad emails without persisting', async () => {
    const users = new InMemoryUsers();
    const uc = new RegisterUserUseCase(users, fakeHasher, makeSigner(), new CapturingOutbox());
    expect((await uc.execute({ email: 'x@y.com', password: 'weak' })).ok).toBe(false);
    expect((await uc.execute({ email: 'bad', password: 'goodpass1' })).ok).toBe(false);
    expect(users.users).toHaveLength(0);
  });

  it('reports AUTH_NOT_CONFIGURED when the signer has no secret', async () => {
    const uc = new RegisterUserUseCase(new InMemoryUsers(), fakeHasher, makeSigner(false), new CapturingOutbox());
    const result = await uc.execute({ email: 'x@y.com', password: 'goodpass1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AUTH_NOT_CONFIGURED');
  });
});

describe('ChangePasswordUseCase', () => {
  it('changes the password when the current one is correct', async () => {
    const users = new InMemoryUsers();
    const created = await users.create({ email: 'a@b.com', phone: null, passwordHash: 'hashed:oldpass1' });
    const creds: IUserCredentialsRepository = {
      async updatePasswordHash(userId, hash) {
        const u = users.users.find((x) => x.id === userId);
        if (u) u.passwordHash = hash;
        return !!u;
      },
    };
    const uc = new ChangePasswordUseCase(users, creds, fakeHasher);

    const wrong = await uc.execute({ userId: created.id, currentPassword: 'nope', newPassword: 'newpass1' });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe('WRONG_PASSWORD');

    const same = await uc.execute({ userId: created.id, currentPassword: 'oldpass1', newPassword: 'oldpass1' });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.code).toBe('SAME_PASSWORD');

    const ok = await uc.execute({ userId: created.id, currentPassword: 'oldpass1', newPassword: 'newpass1' });
    expect(ok.ok).toBe(true);
    expect(created.passwordHash).toBe('hashed:newpass1');
  });
});

class FakeUserAdmin implements IUserAdminRepository {
  constructor(
    public users: Array<{ id: string; isActive: boolean }>,
    public roles: string[],
    public assignments: Array<{ userId: string; roleId: string }> = []
  ) {}
  async setActive(userId: string, isActive: boolean) {
    const u = this.users.find((x) => x.id === userId);
    if (!u) return null;
    u.isActive = isActive;
    return { id: u.id, email: 'x@y.com', phone: null, passwordHash: 'h', isActive, createdAt: new Date() };
  }
  async assignRole(userId: string, roleId: string): Promise<RoleAssignmentOutcome> {
    if (!this.users.find((u) => u.id === userId)) return 'USER_NOT_FOUND';
    if (!this.roles.includes(roleId)) return 'ROLE_NOT_FOUND';
    if (this.assignments.find((a) => a.userId === userId && a.roleId === roleId)) return 'ALREADY_ASSIGNED';
    this.assignments.push({ userId, roleId });
    return 'OK';
  }
  async removeRole(userId: string, roleId: string): Promise<RoleAssignmentOutcome> {
    if (!this.users.find((u) => u.id === userId)) return 'USER_NOT_FOUND';
    if (!this.roles.includes(roleId)) return 'ROLE_NOT_FOUND';
    const before = this.assignments.length;
    this.assignments = this.assignments.filter((a) => !(a.userId === userId && a.roleId === roleId));
    return this.assignments.length < before ? 'OK' : 'NOT_ASSIGNED';
  }
}

describe('admin user account use cases', () => {
  it('blocks self-deactivation but allows deactivating others', async () => {
    const repo = new FakeUserAdmin([{ id: 'admin-1', isActive: true }, { id: 'user-2', isActive: true }], []);
    const uc = new SetUserActiveUseCase(repo);

    const self = await uc.execute({ actorId: 'admin-1', userId: 'admin-1', isActive: false });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.code).toBe('SELF_LOCKOUT');

    const other = await uc.execute({ actorId: 'admin-1', userId: 'user-2', isActive: false });
    expect(other.ok).toBe(true);
  });

  it('blocks changing your own roles and validates role existence', async () => {
    const repo = new FakeUserAdmin([{ id: 'admin-1', isActive: true }, { id: 'user-2', isActive: true }], ['role-x']);
    const assign = new AssignUserRoleUseCase(repo);
    const remove = new RemoveUserRoleUseCase(repo);

    const selfChange = await assign.execute({ actorId: 'admin-1', userId: 'admin-1', roleId: 'role-x' });
    expect(selfChange.ok).toBe(false);
    if (!selfChange.ok) expect(selfChange.code).toBe('SELF_CHANGE');

    const badRole = await assign.execute({ actorId: 'admin-1', userId: 'user-2', roleId: 'role-missing' });
    expect(badRole.ok).toBe(false);
    if (!badRole.ok) expect(badRole.code).toBe('ROLE_NOT_FOUND');

    const ok = await assign.execute({ actorId: 'admin-1', userId: 'user-2', roleId: 'role-x' });
    expect(ok.ok).toBe(true);

    const removed = await remove.execute({ actorId: 'admin-1', userId: 'user-2', roleId: 'role-x' });
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.outcome).toBe('OK');
  });
});
