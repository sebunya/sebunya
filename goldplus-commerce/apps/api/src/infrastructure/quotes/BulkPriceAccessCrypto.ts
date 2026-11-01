import { createHash, createHmac } from 'node:crypto';
import type { PriceAccessCrypto } from '../../application/use-cases/quotes/BulkPriceAccessUseCases';
import { otpHash, otpRandom } from '../loyalty/LoyaltyIdentityInfrastructure';

/**
 * Codes are made and hashed exactly as account phone codes are (otpRandom,
 * otpHash). The access token is signed with its own key, BULK_PRICE_TOKEN_KEY,
 * else one derived from JWT_SECRET; changing it signs every buyer out of bulk
 * prices, and they prove their phone again.
 */
const LOCAL_TEST_KEY = 'local-test-only-bulk-price-key-000000000000';

/**
 * The secret behind the token key. In production a missing secret is a startup
 * error: the local fallback is in the public repo, so signing with it would let
 * anyone mint a token and read dealer prices.
 */
export function bulkPriceTokenSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.BULK_PRICE_TOKEN_KEY?.trim() || env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === 'production') {
    throw new Error('BULK_PRICE_TOKEN_KEY or JWT_SECRET must be set in production (bulk price-access tokens).');
  }
  return LOCAL_TEST_KEY;
}

// Checked when the API loads, so a production box without a secret refuses to start.
const startupSecret = bulkPriceTokenSecret();

let tokenKey: Buffer | null = null;
function key(): Buffer {
  tokenKey ??= createHash('sha256').update(`goldplus-bulk-price-access:${startupSecret}`).digest();
  return tokenKey;
}

export const bulkPriceAccessCrypto: PriceAccessCrypto = {
  newCode: otpRandom,
  hashCode: otpHash,
  sign: (body: string) => createHmac('sha256', key()).update(body).digest('hex'),
};
