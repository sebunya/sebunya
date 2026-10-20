import { createHash, createHmac, randomInt } from 'node:crypto';

/**
 * Gift card and store credit codes are bearer secrets: only HMAC(code) is stored. The key must outlive every card
 * in circulation, so it is NOT the JWT secret (rotated after an incident); it is CREDIT_CODE_KEY, else derived from
 * IDENTITY_HASH_PEPPER, which already cannot change without breaking every identity hash. With neither set the
 * service refuses to issue or read codes in production rather than use a guessable key.
 */
let cached: Buffer | null = null;
export function creditCodeKeyConfigured(): boolean {
  return Boolean(process.env.CREDIT_CODE_KEY || process.env.IDENTITY_HASH_PEPPER) || process.env.NODE_ENV !== 'production';
}
function key(): Buffer {
  if (!creditCodeKeyConfigured()) throw new Error('CREDIT_CODE_KEY_NOT_CONFIGURED');
  cached ??= createHash('sha256')
    .update(`goldplus-credit-code:${process.env.CREDIT_CODE_KEY || process.env.IDENTITY_HASH_PEPPER || 'local-test-only-credit-code-key-0000000000'}`)
    .digest();
  return cached;
}
export const creditCodeHash = (code: string): string => createHmac('sha256', key()).update(code).digest('hex');
export const creditRandomIndexes = (): number[] => Array.from({ length: 11 }, () => randomInt(0, 32));
