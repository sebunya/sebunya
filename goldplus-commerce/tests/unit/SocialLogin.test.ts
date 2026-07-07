import { describe, expect, it } from 'vitest';
import { SocialLoginUseCase } from '../../apps/api/src/application/use-cases/identity/SocialLoginUseCase';
import { GoogleOAuthAdapter, FetchLike } from '../../apps/api/src/infrastructure/auth/GoogleOAuthAdapter';
import { IUserRepository, PersistedUser } from '../../apps/api/src/application/ports/IUserRepository';
import {
  IUserIdentityRepository,
  PersistedUserIdentity,
  ISocialIdentityProvider,
  SocialProfileResult,
} from '../../apps/api/src/application/ports/IUserIdentityRepository';
import { IPasswordHasher } from '../../apps/api/src/application/ports/IPasswordHasher';
import { ITokenSigner } from '../../apps/api/src/application/ports/ITokenSigner';
import { IOutboxWriter } from '../../apps/api/src/application/ports/IOutboxWriter';

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

class InMemoryIdentities implements IUserIdentityRepository {
  public items: PersistedUserIdentity[] = [];
  async findByProvider(provider: string, providerUserId: string) {
    return this.items.find((i) => i.provider === provider && i.providerUserId === providerUserId) ?? null;
  }
  async link(input: { userId: string; provider: string; providerUserId: string; email: string | null }) {
    const identity: PersistedUserIdentity = { ...input, id: `id-${this.items.length + 1}`, createdAt: new Date() };
    this.items.push(identity);
    return identity;
  }
  async listForUser(userId: string) {
    return this.items.filter((i) => i.userId === userId);
  }
  async unlink(userId: string, provider: string) {
    const before = this.items.length;
    this.items = this.items.filter((i) => !(i.userId === userId && i.provider === provider));
    return this.items.length < before;
  }
}

const fakeHasher: IPasswordHasher = {
  async hash(p: string) {
    return `hashed:${p}`;
  },
  async verify() {
    return false;
  },
};

const signer: ITokenSigner = {
  isConfigured: () => true,
  async sign() {
    return 'token-xyz';
  },
  async verify() {
    return null;
  },
};

const noopOutbox: IOutboxWriter = { async append() {} };

function providerReturning(result: SocialProfileResult): ISocialIdentityProvider {
  return {
    provider: 'google',
    isConfigured: () => true,
    getAuthorizationUrl: () => 'https://accounts.google.com/...',
    async fetchProfile() {
      return result;
    },
  };
}

const verifiedProfile: SocialProfileResult = {
  ok: true,
  profile: { providerUserId: 'g-123', email: 'social@example.com', emailVerified: true, name: 'Social User' },
};

describe('SocialLoginUseCase', () => {
  it('creates a new account on first social login', async () => {
    const users = new InMemoryUsers();
    const identities = new InMemoryIdentities();
    const uc = new SocialLoginUseCase(providerReturning(verifiedProfile), users, identities, fakeHasher, signer, noopOutbox);

    const result = await uc.execute({ code: 'auth-code' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('REGISTERED');
      expect(result.user.email).toBe('social@example.com');
    }
    expect(users.users).toHaveLength(1);
    expect(identities.items).toHaveLength(1);
  });

  it('signs in an existing linked identity without creating a new user', async () => {
    const users = new InMemoryUsers();
    const identities = new InMemoryIdentities();
    const existing = await users.create({ email: 'social@example.com', phone: null, passwordHash: 'h' });
    await identities.link({ userId: existing.id, provider: 'google', providerUserId: 'g-123', email: 'social@example.com' });

    const uc = new SocialLoginUseCase(providerReturning(verifiedProfile), users, identities, fakeHasher, signer, noopOutbox);
    const result = await uc.execute({ code: 'auth-code' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome).toBe('SIGNED_IN');
    expect(users.users).toHaveLength(1);
  });

  it('links to an existing account with the same verified email', async () => {
    const users = new InMemoryUsers();
    const identities = new InMemoryIdentities();
    await users.create({ email: 'social@example.com', phone: null, passwordHash: 'h' });

    const uc = new SocialLoginUseCase(providerReturning(verifiedProfile), users, identities, fakeHasher, signer, noopOutbox);
    const result = await uc.execute({ code: 'auth-code' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome).toBe('LINKED');
    expect(identities.items).toHaveLength(1);
    expect(users.users).toHaveLength(1);
  });

  it('refuses to take over an account when the provider email is unverified', async () => {
    const users = new InMemoryUsers();
    await users.create({ email: 'social@example.com', phone: null, passwordHash: 'h' });
    const uc = new SocialLoginUseCase(
      providerReturning({ ok: true, profile: { providerUserId: 'g-9', email: 'social@example.com', emailVerified: false, name: null } }),
      users,
      new InMemoryIdentities(),
      fakeHasher,
      signer,
      noopOutbox
    );
    const result = await uc.execute({ code: 'auth-code' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMAIL_UNVERIFIED');
  });

  it('propagates provider NOT_CONFIGURED', async () => {
    const uc = new SocialLoginUseCase(
      providerReturning({ ok: false, code: 'NOT_CONFIGURED', message: 'no creds' }),
      new InMemoryUsers(),
      new InMemoryIdentities(),
      fakeHasher,
      signer,
      noopOutbox
    );
    const result = await uc.execute({ code: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_CONFIGURED');
  });

  it('rejects a disabled account', async () => {
    const users = new InMemoryUsers();
    const identities = new InMemoryIdentities();
    const u = await users.create({ email: 'social@example.com', phone: null, passwordHash: 'h' });
    u.isActive = false;
    await identities.link({ userId: u.id, provider: 'google', providerUserId: 'g-123', email: u.email });
    const uc = new SocialLoginUseCase(providerReturning(verifiedProfile), users, identities, fakeHasher, signer, noopOutbox);
    const result = await uc.execute({ code: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('GoogleOAuthAdapter', () => {
  const savedEnv = { ...process.env };
  const restore = () => {
    process.env = { ...savedEnv };
  };

  it('is NOT_CONFIGURED without credentials', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const adapter = new GoogleOAuthAdapter();
    expect(adapter.isConfigured()).toBe(false);
    expect(adapter.getAuthorizationUrl('state')).toBeNull();
    const result = await adapter.fetchProfile('code');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_CONFIGURED');
    restore();
  });

  it('exchanges a code and returns a verified profile', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://goldplus.example/auth/google/callback';

    const fetchFn: FetchLike = async (url: string) => {
      if (url.includes('/token')) {
        return new Response(JSON.stringify({ access_token: 'at-1' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ sub: 'g-77', email: 'user@example.com', email_verified: true, name: 'User' }),
        { status: 200 }
      );
    };
    const adapter = new GoogleOAuthAdapter(fetchFn);
    expect(adapter.isConfigured()).toBe(true);
    expect(adapter.getAuthorizationUrl('state-1')).toContain('accounts.google.com');

    const result = await adapter.fetchProfile('code-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.providerUserId).toBe('g-77');
      expect(result.profile.emailVerified).toBe(true);
    }
    restore();
  });

  it('reports EXCHANGE_FAILED when Google rejects the code', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://goldplus.example/cb';
    const fetchFn: FetchLike = async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'bad code' }), { status: 400 });
    const adapter = new GoogleOAuthAdapter(fetchFn);
    const result = await adapter.fetchProfile('bad');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EXCHANGE_FAILED');
    restore();
  });
});
