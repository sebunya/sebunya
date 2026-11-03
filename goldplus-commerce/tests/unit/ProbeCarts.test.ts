import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AbandonmentUseCase, PROBE_CART_MAX_AGE_MS } from '../../apps/api/src/application/use-cases/abandonment/AbandonmentUseCase';
import { MutateCartUseCase } from '../../apps/api/src/application/use-cases/commerce/MutateCartUseCase';
import { PROBE_HEADER } from '../../apps/api/src/application/use-cases/telemetry/DeclaredAutomation';
import { PROBE_HEADER as WEB_PROBE_HEADER } from '../../apps/web/src/lib/cartClient';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/**
 * Probe carts (migration 0217, 2026-11-03). Every automated journey that adds to the basket used to leave a
 * cart that looked like a customer: 238 of 245 weekly "carts with items" on production were the synthetic
 * monitor and the post-deploy compatibility smoke. A cart created by declared automation is marked, kept out
 * of every count, sweep and reminder, and deleted by the hourly scan once it is an hour old.
 */
describe('probe carts never pass for customers', () => {
  it('the storefront and the API agree on the header that carries the audits\' probe cookie', () => {
    expect(WEB_PROBE_HEADER).toBe(PROBE_HEADER);
    expect(read('apps/web/src/pages/cart.astro')).toContain('{ probe: isDeclaredAutomation(Astro.request.headers) }');
    expect(read('apps/api/src/interfaces/http/routes/commerce.ts')).toContain("probe: isDeclaredAutomationUa(c.req.header('user-agent')) || c.req.header(PROBE_HEADER) === '1'");
  });

  it('a first ADD from a probe creates the cart marked as a probe; a customer\'s is not', async () => {
    const created: Array<{ probe?: boolean }> = [];
    let exists = false;
    const carts = {
      find: async () => (exists ? { id: 'c1', ownerKind: 'GUEST', ownerId: 'g1', version: 1, items: [], updatedAt: new Date() } : null),
      create: async (_id: string, _owner: unknown, options?: { probe?: boolean }) => { created.push(options ?? {}); exists = true; },
      claimOwnership: async () => true,
      replaceItems: async () => ({ ok: true as const, version: 2 }),
    };
    const uc = new MutateCartUseCase({
      carts: carts as never,
      products: { findPurchasable: async () => [{ id: 'p1', price: 1000, stockQuantity: 5 }] } as never,
    } as never);
    const owner = { kind: 'GUEST' as const, id: 'g1' };
    await uc.mutate({ cartId: 'c1', owner, mutation: { kind: 'ADD', productId: 'p1', quantity: 1 }, traceId: 't', probe: true });
    exists = false;
    await uc.mutate({ cartId: 'c2', owner, mutation: { kind: 'ADD', productId: 'p1', quantity: 1 }, traceId: 't' });
    expect(created).toEqual([{ probe: true }, { probe: false }]);
  });

  it('the hourly scan purges probe carts older than an hour', async () => {
    const purged: Date[] = [];
    const repo = {
      resumeChanged: async () => 0,
      findNewlyAbandoned: async () => [],
      createOpen: async () => null,
      expireOverdue: async () => 0,
      purgeProbeCarts: async (olderThan: Date) => { purged.push(olderThan); return 3; },
    };
    const now = new Date('2026-11-03T20:00:00Z');
    const uc = new AbandonmentUseCase(repo as never, { publish: async () => {} } as never, () => now);
    await uc.scan();
    expect(PROBE_CART_MAX_AGE_MS).toBe(60 * 60 * 1000);
    expect(purged).toEqual([new Date(now.getTime() - PROBE_CART_MAX_AGE_MS)]);
  });

  it('every reader that counts baskets leaves probe carts out', () => {
    for (const f of [
      'apps/api/src/infrastructure/db/repositories/DrizzleOutcomesReader.ts',
      'apps/api/src/infrastructure/db/repositories/DrizzleOutcomeSuggestionReader.ts',
      'apps/api/src/infrastructure/db/repositories/DrizzleSalesFunnelReader.ts',
    ]) expect(read(f), f).toContain('not c.is_probe');
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleAbandonmentRepository.ts')).toContain('sql`not ${carts.isProbe}`');
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleCustomerSignalReader.ts')).toContain('sql`not ${carts.isProbe}`');
    expect(read('apps/api/src/infrastructure/db/migrations/0217_probe_carts.sql')).toContain('ADD COLUMN IF NOT EXISTS "is_probe" boolean NOT NULL DEFAULT false');
  });
});
