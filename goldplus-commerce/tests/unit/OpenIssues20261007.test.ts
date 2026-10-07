import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AwardBirthdayPointsUseCase } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyGamificationUseCases';

const root = join(__dirname, '../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

function birthdayFakes(byDay: Record<string, string[]>) {
  const asked: string[] = [];
  const keys: string[] = [];
  const uc = new AwardBirthdayPointsUseCase(
    {
      async getOrCreateAccount(userId: string) { return { id: `acc-${userId}` }; },
      async append(input: { idempotencyKey: string }) { keys.push(input.idempotencyKey); return { replay: false }; },
    } as never,
    { async getProgrammeConfig() { return { enabled: true, killSwitch: false, birthdayPoints: 100 }; } } as never,
    { async usersWithBirthdayOn({ month, day }: { month: number; day: number }) {
      asked.push(`${month}-${day}`);
      return (byDay[`${month}-${day}`] ?? []).map((userId) => ({ userId }));
    } } as never,
  );
  return { uc, asked, keys };
}

describe('birthdays follow the Kampala calendar (2026-10-07)', () => {
  it('01:00 Kampala on 8 Oct (22:00 UTC on 7 Oct) celebrates 8 October', async () => {
    const f = birthdayFakes({ '10-8': ['u1'] });
    expect(await f.uc.execute(new Date('2026-10-07T22:00:00Z'))).toEqual({ awarded: 1 });
    expect(f.asked).toEqual(['10-8']);
    expect(f.keys).toEqual(['birthday:u1:2026']);
  });

  it('29 February birthdays are celebrated on 28 February in a non-leap year', async () => {
    const f = birthdayFakes({ '2-28': ['a'], '2-29': ['leapling'] });
    expect(await f.uc.execute(new Date('2027-02-28T09:00:00Z'))).toEqual({ awarded: 2 });
    expect(f.asked).toEqual(['2-28', '2-29']);
  });

  it('in a leap year 28 February does not also pull in 29 February', async () => {
    const f = birthdayFakes({ '2-29': ['leapling'] });
    await f.uc.execute(new Date('2028-02-28T09:00:00Z'));
    expect(f.asked).toEqual(['2-28']);
  });
});

describe('sessions, logs and payments (2026-10-07)', () => {
  it('a verification scan or fake report earns only for a LIVE session', () => {
    const g = read('apps/api/src/interfaces/http/routes/governance.ts');
    expect(g).not.toMatch(/tokenSigner\.verify\(/);
    expect(g.match(/resolveLiveSession\(bearerTokenFrom\(/g)?.length).toBe(2);
  });

  it('log lines take the user from the verified session, never from a header', () => {
    expect(read('apps/api/src/interfaces/http/app.ts')).not.toMatch(/c\.req\.header\('x-user-id'\)/);
    expect(read('apps/api/src/interfaces/http/middleware/auth.ts')).toMatch(/trace\.userId = user\.id/);
  });

  it('a wrong reference from the public callback changes nothing', () => {
    const v = read('apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts');
    const guard = v.indexOf('if (reference !== attempt.merchantReference)');
    expect(guard).toBeGreaterThan(-1);
    expect(v.slice(guard, v.indexOf('}', v.indexOf('REFERENCE_MISMATCH')))).not.toMatch(/updatePaymentAttemptStatus/);
  });

  it('admin expiry respects the redemption pause, and a reversal needs a reason', () => {
    const r = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
    expect(r).toMatch(/isRedemptionHalted\(config, await registry\.loyaltyGate\.isActive\(\)\)/);
    expect(r).toMatch(/code: 'REASON_REQUIRED'/);
  });
});

describe('checkout releases reserved points when it is refused (2026-10-07)', () => {
  it('everything between reserving points and saving the order releases them on failure', () => {
    const c = read('apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts');
    const reserveAt = c.indexOf('this.loyaltyRedemption.reserve(');
    const guardAt = c.indexOf('const { reservation, order } = await (async () => {');
    const releaseAt = c.indexOf('await this.loyaltyRedemption.release({ reservationId: loyaltyReservation.reservationId })', guardAt);
    expect(reserveAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(reserveAt);
    // The stock hold and the cash limit are inside the guarded block.
    expect(c.indexOf('capacity.reserve(', guardAt)).toBeLessThan(releaseAt);
    expect(c.indexOf('COD_LIMIT_EXCEEDED', guardAt)).toBeLessThan(releaseAt);
  });
});

describe('Google/Apple sign-in onto a password account (2026-10-07)', () => {
  it('passes revokePasswordAccess when the account has a password', () => {
    expect(read('apps/api/src/application/use-cases/identity/ResolveSocialIdentityUseCase.ts')).toMatch(/revokePasswordAccess: !!byEmail\.passwordHash/);
  });
});
