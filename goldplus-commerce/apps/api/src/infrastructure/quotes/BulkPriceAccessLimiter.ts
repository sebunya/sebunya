import type { PriceAccessLimiter } from '../../application/use-cases/quotes/BulkPriceAccessUseCases';
import { abuseControlStore } from '../security/RedisAbuseControlStore';

/**
 * Bulk price-access budgets on the distributed abuse-control store (Redis, with
 * its stricter local fallback), so every API replica shares one count.
 */
export const bulkPriceAccessLimiter: PriceAccessLimiter = {
  async allow(scope, key, limit) {
    const decision = await abuseControlStore.consume({ control: 'bulk-price-access', endpoint: scope, identity: key, limit, outagePolicy: 'STRICT' });
    return decision.allowed;
  },
};
