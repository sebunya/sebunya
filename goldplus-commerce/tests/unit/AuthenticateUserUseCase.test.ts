import { describe, it, expect, vi } from 'vitest';
import { AuthenticateUserUseCase } from '../../apps/api/src/application/use-cases/identity/AuthenticateUserUseCase';
import { IUserRepository } from '../../apps/api/src/application/ports/IUserRepository';
import { IPasswordHasher } from '../../apps/api/src/application/ports/IPasswordHasher';
import { ITokenSigner } from '../../apps/api/src/application/ports/ITokenSigner';

describe('AuthenticateUserUseCase', () => {
  const mockUser = {
    id: 'u1',
    email: 'test@goldplus.com',
    phone: null,
    passwordHash: 'hash123',
    isActive: true,
    createdAt: new Date(),
  };

  const createMocks = () => ({
    users: {
      findByEmail: vi.fn().mockResolvedValue(mockUser),
      findById: vi.fn(),
      create: vi.fn(),
    } as IUserRepository,
    hasher: {
      hash: vi.fn(),
      verify: vi.fn().mockResolvedValue(true),
    } as IPasswordHasher,
    signer: {
      isConfigured: vi.fn().mockReturnValue(true),
      sign: vi.fn().mockResolvedValue('signed-jwt-token'),
      verify: vi.fn(),
    } as ITokenSigner,
  });

  it('Should succeed with correct credentials and return token', async () => {
    const { users, hasher, signer } = createMocks();
    const uc = new AuthenticateUserUseCase(users, hasher, signer);

    const res = await uc.execute({ email: 'TEST@goldplus.com ', password: 'p1' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.token).toBe('signed-jwt-token');
      expect(res.user.email).toBe(mockUser.email);
    }
    expect(users.findByEmail).toHaveBeenCalledWith('test@goldplus.com');
  });

  it('Should fail if signer not configured', async () => {
    const { users, hasher, signer } = createMocks();
    (signer.isConfigured as any).mockReturnValue(false);
    const uc = new AuthenticateUserUseCase(users, hasher, signer);

    const res = await uc.execute({ email: 'a@a.com', password: 'p1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('Should fail gracefully on wrong password', async () => {
    const { users, hasher, signer } = createMocks();
    (hasher.verify as any).mockResolvedValue(false);
    const uc = new AuthenticateUserUseCase(users, hasher, signer);

    const res = await uc.execute({ email: 'a@a.com', password: 'wrong' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_CREDENTIALS');
  });

  it('Should reject blocked accounts', async () => {
    const { users, hasher, signer } = createMocks();
    (users.findByEmail as any).mockResolvedValue({ ...mockUser, isActive: false });
    const uc = new AuthenticateUserUseCase(users, hasher, signer);

    const res = await uc.execute({ email: 'a@a.com', password: 'p1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('ACCOUNT_DISABLED');
  });
});
