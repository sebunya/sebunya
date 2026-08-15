import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GetPhoneVerificationStateUseCase } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyIdentityUseCases';

/**
 * The verification JOURNEY, against real PostgreSQL.
 *
 * The owner's production defect was not that verification failed — a real SMS
 * arrived and a real code verified the phone. It was that leaving the Rewards
 * page lost the thread: the "we sent you a code" message lived only in the POST
 * response. The challenge was in this table the whole time.
 *
 * So these tests read the real table through the real repository. A mock would
 * happily answer "ACTIVE" for a row that PostgreSQL never stored.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('phone verification journey on real PostgreSQL', () => {
  let raw: any;
  let repo: any;
  const userIds: string[] = [];
  const tag = `pvj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const newUser = async (): Promise<string> => {
    const [row] = await raw`
      insert into users (email, password_hash, display_name)
      values (${`${tag}-${userIds.length}@example.test`}, 'x', 'Journey Test') returning id`;
    userIds.push(row.id);
    return row.id;
  };

  const seedChallenge = async (
    userId: string,
    opts: { minutesAgo?: number; expiresInMinutes?: number; consumed?: boolean; attempts?: number } = {},
  ) => {
    const { minutesAgo = 0, expiresInMinutes = 10, consumed = false, attempts = 0 } = opts;
    await raw`
      insert into phone_verification_codes (user_id, phone_e164, code_hash, attempts, expires_at, consumed_at, created_at)
      values (${userId}, '+256705123456', ${'d'.repeat(64)}, ${attempts},
              now() - (${minutesAgo} * interval '1 minute') + (${expiresInMinutes} * interval '1 minute'),
              ${consumed ? raw`now()` : null},
              now() - (${minutesAgo} * interval '1 minute'))`;
  };

  const stateFor = (userId: string) => repo && new GetPhoneVerificationStateUseCase(repo).execute({ userId });

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
    const mod = await import('../../apps/api/src/infrastructure/loyalty/LoyaltyIdentityInfrastructure');
    repo = new (mod as any).DrizzleLoyaltyIdentityRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    if (userIds.length) {
      await raw`delete from phone_verification_codes where user_id = any(${userIds})`;
      await raw`delete from users where id = any(${userIds})`;
    }
    await raw.end({ timeout: 5 });
  });

  it('finds no journey for a customer who never asked', async () => {
    const userId = await newUser();
    expect((await stateFor(userId)).status).toBe('NONE');
  });

  it('finds the SAME active challenge on a later, independent read', async () => {
    const userId = await newUser();
    await seedChallenge(userId);

    // Two separate reads, as a refresh or a return-from-Orders would produce.
    const first: any = await stateFor(userId);
    const second: any = await stateFor(userId);

    expect(first.status).toBe('ACTIVE');
    expect(second.status).toBe('ACTIVE');
    expect(second.expiresAt).toBe(first.expiresAt);
    // Reading the state must never send anything or create anything.
    const [{ n }] = await raw`
      select count(*)::int as n from phone_verification_codes where user_id = ${userId}`;
    expect(n).toBe(1);
  });

  it('reports EXPIRED for a challenge past its expiry', async () => {
    const userId = await newUser();
    await seedChallenge(userId, { minutesAgo: 30, expiresInMinutes: 10 });
    expect((await stateFor(userId)).status).toBe('EXPIRED');
  });

  it('reports NONE once the challenge is consumed', async () => {
    const userId = await newUser();
    await seedChallenge(userId, { consumed: true });
    expect((await stateFor(userId)).status).toBe('NONE');
  });

  it('follows the newest challenge when a resend supersedes an older one', async () => {
    const userId = await newUser();
    await seedChallenge(userId, { minutesAgo: 5, expiresInMinutes: 10 });
    await seedChallenge(userId, { minutesAgo: 0, expiresInMinutes: 10 });

    const result: any = await stateFor(userId);
    expect(result.status).toBe('ACTIVE');
    // Cooldown is measured from the LATEST issue, so a resend cannot be
    // requested again immediately.
    expect(result.resendAvailableAt).not.toBeNull();
  });

  it('reports resend availability once the cooldown has elapsed', async () => {
    const userId = await newUser();
    await seedChallenge(userId, { minutesAgo: 5, expiresInMinutes: 30 });
    const result: any = await stateFor(userId);
    expect(result.resendAvailableAt).toBeNull();
  });

  it('counts down remaining attempts from the stored row', async () => {
    const userId = await newUser();
    await seedChallenge(userId, { attempts: 4 });
    expect(((await stateFor(userId)) as any).attemptsRemaining).toBe(1);
  });

  it('never returns the stored hash to the caller', async () => {
    const userId = await newUser();
    await seedChallenge(userId);
    const serialised = JSON.stringify(await stateFor(userId));
    expect(serialised).not.toContain('d'.repeat(64));
  });

  it('keeps one customer journey invisible to another', async () => {
    const owner = await newUser();
    const stranger = await newUser();
    await seedChallenge(owner);
    expect((await stateFor(stranger)).status).toBe('NONE');
  });
});
