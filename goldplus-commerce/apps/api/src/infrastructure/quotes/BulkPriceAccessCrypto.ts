import { createHash, createHmac } from 'node:crypto';
import type { PriceAccessCrypto } from '../../application/use-cases/quotes/BulkPriceAccessUseCases';
import { otpHash, otpRandom } from '../loyalty/LoyaltyIdentityInfrastructure';

/**
 * Codes are made and hashed exactly as account phone codes are (otpRandom,
 * otpHash). The access token is signed with its own key, BULK_PRICE_TOKEN_KEY,
 * else one derived from JWT_SECRET; changing it signs every buyer out of bulk
 * prices, and they prove their phone again.
 */
let tokenKey: Buffer | null = null;
function key(): Buffer {
  tokenKey ??= createHash('sha256')
    .update(`goldplus-bulk-price-access:${process.env.BULK_PRICE_TOKEN_KEY || process.env.JWT_SECRET || 'local-test-only-bulk-price-key-000000000000'}`)
    .digest();
  return tokenKey;
}

export const bulkPriceAccessCrypto: PriceAccessCrypto = {
  newCode: otpRandom,
  hashCode: otpHash,
  sign: (body: string) => createHmac('sha256', key()).update(body).digest('hex'),
};
