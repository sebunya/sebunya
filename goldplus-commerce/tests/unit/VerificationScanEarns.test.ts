import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { VerificationCheckUseCase } from '../../apps/api/src/application/use-cases/VerificationCheckUseCase';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/**
 * The route read `isSuccessful`, a key the use case never returns, so every
 * signed-in scan counted as failed and nothing ever earned; and the attempt
 * never carried the scanner, so "verify ten" always read 0.
 */
describe('a signed-in verification scan is attributable and can earn', () => {
  it('the attempt row carries the signed-in scanner', async () => {
    const saveAttempt = vi.fn();
    const repo = { findCode: async () => ({ productId: 'p1', isUsed: false }), saveAttempt, markCodeAsUsed: vi.fn() };
    const out = await new VerificationCheckUseCase(repo as never).execute('ABC123', '1.1.1.1', 'ua', 'user-1');
    expect(out).toEqual({ success: true, productId: 'p1' });
    expect(saveAttempt.mock.calls[0][0].userId).toBe('user-1');
  });

  it('an anonymous scan stays anonymous', async () => {
    const saveAttempt = vi.fn();
    const repo = { findCode: async () => null, saveAttempt, markCodeAsUsed: vi.fn() };
    await new VerificationCheckUseCase(repo as never).execute('ABC123');
    expect(saveAttempt.mock.calls[0][0].userId).toBeNull();
  });

  it('the repository writes user_id and the route reads the use case\'s own success flag', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleVerificationRepository.ts')).toMatch(/userId: attempt\.userId/);
    const route = read('apps/api/src/interfaces/http/routes/governance.ts');
    expect(route).not.toMatch(/\.isSuccessful\)/);
    expect(route).toMatch(/const successful = result\.success === true;/);
    expect(route).toMatch(/verificationCheckUseCase\.execute\(code, ip, ua, verified\?\.subject \?\? null\)/);
  });

  it('the verification page forwards the session so a signed-in scan is recognised', () => {
    expect(read('apps/web/src/pages/verification/index.astro')).toMatch(/postJson\('\/governance\/verification\/check', \{ code \}, Astro\.cookies\.get\('goldplus_session'\)/);
  });
});
