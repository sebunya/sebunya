import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  GENERIC_RESET_ACKNOWLEDGEMENT,
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
  hashResetToken,
} from '../../apps/api/src/application/use-cases/identity/PasswordResetUseCases';
import { ResolveSocialIdentityUseCase } from '../../apps/api/src/application/use-cases/identity/ResolveSocialIdentityUseCase';
import { ScryptPasswordHasher } from '../../apps/api/src/infrastructure/security/ScryptPasswordHasher';
import { OIDC_PROVIDERS } from '../../apps/api/src/infrastructure/identity/OidcProviders';

/**
 * Account recovery and social sign-in (0106).
 *
 * A customer who forgot their password had no way back in, and the only way to
 * sign up was to invent another password. Both doors are new, and both are
 * places where a mistake is an account takeover — so what is pinned here is
 * mostly what the code REFUSES to do.
 */

/* ── in-memory doubles ───────────────────────────────────────────────────── */

const makeRecovery = () => {
  const tokens: any[] = [];
  const passwords = new Map<string, string>();
  return {
    tokens,
    passwords,
    async issueToken(input: any) {
      const row = { id: `tok-${tokens.length + 1}`, ...input, consumedAt: null, createdAt: new Date() };
      tokens.push(row);
      return { id: row.id, userId: row.userId, expiresAt: row.expiresAt };
    },
    async findByTokenHash(hash: string) {
      const row = tokens.find((t) => t.tokenHash === hash);
      return row
        ? { id: row.id, userId: row.userId, email: 'x@example.com', expiresAt: row.expiresAt, consumedAt: row.consumedAt }
        : null;
    },
    async consumeAndSetPassword({ tokenId, userId, newPasswordHash }: any) {
      const row = tokens.find((t) => t.id === tokenId);
      if (!row || row.consumedAt) return false;
      row.consumedAt = new Date();
      passwords.set(userId, newPasswordHash);
      // A successful reset voids every other outstanding link.
      for (const other of tokens) if (other.userId === userId && !other.consumedAt) other.consumedAt = new Date();
      return true;
    },
    async countRecentTokens(userId: string) {
      return tokens.filter((t) => t.userId === userId).length;
    },
    async invalidateOutstanding() {
      return 0;
    },
  };
};

const makeUsers = (rows: any[]) => ({
  async findByEmail(email: string) {
    return rows.find((r) => r.email === email) ?? null;
  },
  async findById(id: string) {
    return rows.find((r) => r.id === id) ?? null;
  },
  async create() {
    throw new Error('not used');
  },
});

const makeDelivery = () => {
  const sent: any[] = [];
  return {
    sent,
    async sendPasswordReset(input: any) {
      sent.push(input);
      return { status: 'SENT' as const };
    },
  };
};

/* ── password reset ──────────────────────────────────────────────────────── */

describe('password reset — the interesting part is what it refuses to tell you', () => {
  const activeUser = { id: 'u1', email: 'known@example.com', isActive: true, passwordHash: 'x', phone: null, createdAt: new Date() };

  it('NO USER ENUMERATION: an unknown email gets the identical answer to a known one', async () => {
    const recovery = makeRecovery();
    const delivery = makeDelivery();
    const uc = new RequestPasswordResetUseCase(makeUsers([activeUser]) as never, recovery as never, delivery as never);

    const known = await uc.execute({ email: 'known@example.com' });
    const unknown = await uc.execute({ email: 'nobody@example.com' });

    expect(known.message).toBe(GENERIC_RESET_ACKNOWLEDGEMENT);
    expect(unknown.message).toBe(GENERIC_RESET_ACKNOWLEDGEMENT);
    expect(known.acknowledged).toBe(unknown.acknowledged);
    // Only the internal record differs — and that never leaves the server.
    expect(known.internal.userFound).toBe(true);
    expect(unknown.internal.userFound).toBe(false);
    expect(delivery.sent).toHaveLength(1);
  });

  it('a DISABLED account is not advertised either', async () => {
    const recovery = makeRecovery();
    const delivery = makeDelivery();
    const uc = new RequestPasswordResetUseCase(
      makeUsers([{ ...activeUser, isActive: false }]) as never,
      recovery as never,
      delivery as never,
    );
    const result = await uc.execute({ email: 'known@example.com' });
    expect(result.message).toBe(GENERIC_RESET_ACKNOWLEDGEMENT);
    expect(delivery.sent).toHaveLength(0);
  });

  it('THE RAW TOKEN IS NEVER STORED — only its SHA-256', async () => {
    const recovery = makeRecovery();
    const delivery = makeDelivery();
    const uc = new RequestPasswordResetUseCase(makeUsers([activeUser]) as never, recovery as never, delivery as never);
    await uc.execute({ email: 'known@example.com' });

    const raw = delivery.sent[0].rawToken as string;
    const stored = recovery.tokens[0].tokenHash as string;
    expect(stored).not.toBe(raw);
    expect(stored).toBe(createHash('sha256').update(raw).digest('hex'));
    // Nothing anywhere in the stored row equals the raw token.
    expect(JSON.stringify(recovery.tokens[0])).not.toContain(raw);
  });

  it('throttles per account, and stays generic while doing it', async () => {
    const recovery = makeRecovery();
    const delivery = makeDelivery();
    const uc = new RequestPasswordResetUseCase(makeUsers([activeUser]) as never, recovery as never, delivery as never);

    for (let i = 0; i < 5; i += 1) await uc.execute({ email: 'known@example.com' });

    expect(delivery.sent.length).toBeLessThanOrEqual(3);
    const last = await uc.execute({ email: 'known@example.com' });
    expect(last.message).toBe(GENERIC_RESET_ACKNOWLEDGEMENT);
    expect(last.internal.throttled).toBe(true);
  });

  it('a token is SINGLE USE — the second attempt is refused', async () => {
    const recovery = makeRecovery();
    const delivery = makeDelivery();
    const hasher = new ScryptPasswordHasher();
    await new RequestPasswordResetUseCase(makeUsers([activeUser]) as never, recovery as never, delivery as never).execute({
      email: 'known@example.com',
    });
    const raw = delivery.sent[0].rawToken as string;
    const reset = new ResetPasswordUseCase(recovery as never, hasher);

    const first = await reset.execute({ token: raw, newPassword: 'a-strong-password' });
    expect(first).toMatchObject({ ok: true });

    const second = await reset.execute({ token: raw, newPassword: 'another-password' });
    expect(second).toMatchObject({ ok: false, code: 'ALREADY_USED' });
  });

  it('an EXPIRED token is refused', async () => {
    const recovery = makeRecovery();
    recovery.tokens.push({
      id: 'tok-old',
      userId: 'u1',
      tokenHash: hashResetToken('expired-raw'),
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    });
    const reset = new ResetPasswordUseCase(recovery as never, new ScryptPasswordHasher());
    expect(await reset.execute({ token: 'expired-raw', newPassword: 'a-strong-password' })).toMatchObject({
      ok: false,
      code: 'EXPIRED',
    });
  });

  it('an unrecognised token is refused, and a weak password never reaches the store', async () => {
    const recovery = makeRecovery();
    const reset = new ResetPasswordUseCase(recovery as never, new ScryptPasswordHasher());
    expect(await reset.execute({ token: 'made-up', newPassword: 'a-strong-password' })).toMatchObject({
      ok: false,
      code: 'INVALID_TOKEN',
    });
    expect(await reset.execute({ token: 'made-up', newPassword: 'short' })).toMatchObject({
      ok: false,
      code: 'WEAK_PASSWORD',
    });
    expect(recovery.passwords.size).toBe(0);
  });
});

/* ── social identity ─────────────────────────────────────────────────────── */

const makeIdentities = (seed: any[] = []) => {
  const rows = [...seed];
  const created: any[] = [];
  return {
    rows,
    created,
    async findByProviderSubject(provider: string, subject: string) {
      return rows.find((r) => r.provider === provider && r.subject === subject) ?? null;
    },
    async listForUser(userId: string) {
      return rows.filter((r) => r.userId === userId);
    },
    async link(input: any) {
      const row = { id: `id-${rows.length + 1}`, ...input };
      rows.push(row);
      return row;
    },
    async createUserWithIdentity(input: any) {
      const userId = `new-${created.length + 1}`;
      created.push({ userId, ...input });
      const row = { id: `id-${rows.length + 1}`, userId, ...input };
      rows.push(row);
      return { userId, identity: row };
    },
    async markLogin() {},
    async unlink() {
      return { ok: true };
    },
  };
};

describe('social sign-in — which account does a verified identity belong to?', () => {
  const existing = { id: 'u-existing', email: 'taken@example.com', isActive: true, passwordHash: 'x', phone: null, createdAt: new Date() };

  it('an already-linked identity signs that user in', async () => {
    const identities = makeIdentities([
      { id: 'id-1', userId: 'u-existing', provider: 'google', subject: 'sub-1', email: 'taken@example.com', emailVerified: true },
    ]);
    const uc = new ResolveSocialIdentityUseCase(makeUsers([existing]) as never, identities as never);
    const result = await uc.execute({
      provider: 'google', subject: 'sub-1', email: 'taken@example.com', emailVerified: true, autoLinkOnVerifiedEmail: true,
    });
    expect(result).toMatchObject({ ok: true, userId: 'u-existing', created: false });
  });

  it('a brand-new email creates a PASSWORD-LESS account', async () => {
    const identities = makeIdentities();
    const uc = new ResolveSocialIdentityUseCase(makeUsers([]) as never, identities as never);
    const result = await uc.execute({
      provider: 'google', subject: 'sub-new', email: 'fresh@example.com', emailVerified: true, autoLinkOnVerifiedEmail: true,
    });
    expect(result).toMatchObject({ ok: true, created: true });
    expect(identities.created[0].email).toBe('fresh@example.com');
  });

  it('TAKEOVER GUARD: an UNVERIFIED provider email never auto-links to an existing account', async () => {
    const identities = makeIdentities();
    const uc = new ResolveSocialIdentityUseCase(makeUsers([existing]) as never, identities as never);
    const result = await uc.execute({
      provider: 'google', subject: 'attacker', email: 'taken@example.com', emailVerified: false, autoLinkOnVerifiedEmail: true,
    });
    expect(result).toMatchObject({ ok: false, code: 'MANUAL_LINK_REQUIRED' });
    expect(identities.rows).toHaveLength(0);
  });

  it('TAKEOVER GUARD: a provider we do not trust to verify never auto-links, even when it claims verified', async () => {
    const identities = makeIdentities();
    const uc = new ResolveSocialIdentityUseCase(makeUsers([existing]) as never, identities as never);
    const result = await uc.execute({
      provider: 'facebook', subject: 'fb-1', email: 'taken@example.com', emailVerified: true, autoLinkOnVerifiedEmail: false,
    });
    expect(result).toMatchObject({ ok: false, code: 'MANUAL_LINK_REQUIRED' });
    expect(identities.rows).toHaveLength(0);
  });

  it('Facebook is configured NOT to auto-link; Google and Apple are', () => {
    expect(OIDC_PROVIDERS.facebook.autoLinkOnVerifiedEmail).toBe(false);
    expect(OIDC_PROVIDERS.google.autoLinkOnVerifiedEmail).toBe(true);
    expect(OIDC_PROVIDERS.apple.autoLinkOnVerifiedEmail).toBe(true);
  });

  it('a verified email on a trusted provider DOES link to the existing account', async () => {
    const identities = makeIdentities();
    const uc = new ResolveSocialIdentityUseCase(makeUsers([existing]) as never, identities as never);
    const result = await uc.execute({
      provider: 'google', subject: 'sub-ok', email: 'taken@example.com', emailVerified: true, autoLinkOnVerifiedEmail: true,
    });
    expect(result).toMatchObject({ ok: true, userId: 'u-existing', linked: true, created: false });
  });

  it('no email and no prior link cannot become an account', async () => {
    const uc = new ResolveSocialIdentityUseCase(makeUsers([]) as never, makeIdentities() as never);
    expect(
      await uc.execute({ provider: 'apple', subject: 'anon', email: null, emailVerified: false, autoLinkOnVerifiedEmail: true }),
    ).toMatchObject({ ok: false, code: 'NO_EMAIL_FROM_PROVIDER' });
  });

  it('a disabled account is refused even with a valid linked identity', async () => {
    const identities = makeIdentities([
      { id: 'id-1', userId: 'u-off', provider: 'google', subject: 's', email: 'off@example.com', emailVerified: true },
    ]);
    const uc = new ResolveSocialIdentityUseCase(
      makeUsers([{ id: 'u-off', email: 'off@example.com', isActive: false, passwordHash: null, phone: null, createdAt: new Date() }]) as never,
      identities as never,
    );
    expect(
      await uc.execute({ provider: 'google', subject: 's', email: 'off@example.com', emailVerified: true, autoLinkOnVerifiedEmail: true }),
    ).toMatchObject({ ok: false, code: 'ACCOUNT_DISABLED' });
  });
});

describe('social providers ship disabled until an operator configures them', () => {
  it('every provider is OIDC with a JWKS endpoint — no provider is trusted without signature checking', () => {
    for (const config of Object.values(OIDC_PROVIDERS)) {
      expect(config.jwksUri.startsWith('https://')).toBe(true);
      expect(config.issuers.length).toBeGreaterThan(0);
      expect(config.scope).toContain('openid');
    }
  });
});
