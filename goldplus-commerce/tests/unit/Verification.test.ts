import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationCheckUseCase, VERIFICATION_CODE_PATTERN } from '../../apps/api/src/application/use-cases/VerificationCheckUseCase';

/** Synthetic fixture codes only; never a real hologram code. */
describe('VerificationCheckUseCase', () => {
  let useCase: VerificationCheckUseCase;
  let repo: any;

  beforeEach(() => {
    repo = { claimCode: vi.fn(), findCode: vi.fn(), saveAttempt: vi.fn() };
    useCase = new VerificationCheckUseCase(repo);
  });

  it('a new registered code is genuine and is claimed once', async () => {
    repo.claimCode.mockResolvedValue({ productId: 'prod-123' });
    const result = await useCase.execute('TEST-NEW-0001', '127.0.0.1', 'test-ua');
    expect(result).toEqual({ success: true, status: 'genuine', productId: 'prod-123' });
    expect(repo.claimCode).toHaveBeenCalledWith('TEST-NEW-0001');
    expect(repo.findCode).not.toHaveBeenCalled();
    expect(repo.saveAttempt.mock.calls[0][0].isSuccessful).toBe(true);
  });

  it('a repeat check is "already checked" with the first check time, not a counterfeit verdict', async () => {
    repo.claimCode.mockResolvedValue(null);
    repo.findCode.mockResolvedValue({ productId: 'prod-123', isUsed: true, usedAt: new Date('2026-11-01T10:00:00Z') });
    const result = await useCase.execute('TEST-USED-0001');
    expect(result).toEqual({ success: false, status: 'already_checked', productId: 'prod-123', firstCheckedAt: '2026-11-01T10:00:00.000Z' });
    expect(repo.saveAttempt.mock.calls[0][0].isSuccessful).toBe(false);
  });

  it('an unknown code is not_found and carries no product', async () => {
    repo.claimCode.mockResolvedValue(null);
    repo.findCode.mockResolvedValue(null);
    const result = await useCase.execute('TEST-NOPE-0001');
    expect(result).toEqual({ success: false, status: 'not_found' });
    expect(repo.saveAttempt).toHaveBeenCalled();
  });

  it('a failed claim (database error) throws instead of answering a verdict', async () => {
    repo.claimCode.mockRejectedValue(new Error('db down'));
    await expect(useCase.execute('TEST-ERR-0001')).rejects.toThrow('db down');
    expect(repo.saveAttempt).not.toHaveBeenCalled();
  });

  it('malformed codes are refused by the shape check before any lookup', () => {
    expect(VERIFICATION_CODE_PATTERN.test('GP-ABCD-EFGH-JKLM')).toBe(true);
    expect(VERIFICATION_CODE_PATTERN.test('x'.repeat(51))).toBe(false);
    expect(VERIFICATION_CODE_PATTERN.test('AB\nCD')).toBe(false);
    expect(VERIFICATION_CODE_PATTERN.test('')).toBe(false);
  });

  it('only a POST can consume a code: no GET route, the page checks on form POST only, copy separates repeat from not found', () => {
    const route = readFileSync('apps/api/src/interfaces/http/routes/governance.ts', 'utf8');
    expect(route).toMatch(/routes\.post\('\/verification\/check'/);
    expect(route).not.toMatch(/routes\.(get|all)\('\/verification/);
    expect(route).toMatch(/VERIFICATION_CODE_PATTERN\.test\(code\)/);
    const page = readFileSync('apps/web/src/pages/verification/index.astro', 'utf8');
    expect(page).toMatch(/if \(Astro\.request\.method === 'POST'\)/);
    expect(page).toMatch(/already_checked/);
    expect(page).not.toMatch(/not recognised, or already used/);
    const about = readFileSync('apps/web/src/pages/about.astro', 'utf8');
    expect(about).not.toMatch(/again when it arrives/);
    expect(about).toMatch(/Each code verifies once/);
  });
});
