import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loyaltyEarnSourceFromOrder,
  loyaltyPaymentQualifies,
  type LoyaltyEarnOrderFacts,
} from '../../apps/api/src/domain/loyalty/LoyaltyEarnEligibility';
import { MediaLibraryUseCase, storedImageFilename } from '../../apps/api/src/application/use-cases/media/MediaLibraryUseCase';
import { planEditorStockWrite } from '../../apps/api/src/domain/inventory/Inventory';
import { SetProductStockUseCase } from '../../apps/api/src/application/use-cases/inventory/SetProductStockUseCase';
import { InventoryLedgerUseCases } from '../../apps/api/src/application/use-cases/batteries/InventoryLedgerUseCases';

/**
 * Sweep 2026-09-24, loyalty + catalogue writes: four confirmed defects.
 *  1. Cash-on-delivery orders never earned points (only payment_status='paid'
 *     qualified, and nothing ever marks a COD order paid).
 *  2. Media uploads kept the client's extension: a GIF/HTML polyglot was served
 *     as text/html on the shop's origin.
 *  3. The product editor's save rewrote stock with the figure it loaded,
 *     silently undoing dispatches and adjustments made since.
 *  4. A stock count could be applied twice at once, posting its difference twice.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

// ---------------------------------------------------------------- 1. loyalty
describe('cash-on-delivery orders earn loyalty points on delivery', () => {
  const base: LoyaltyEarnOrderFacts = {
    userId: 'u1', totalUgx: 300_000, paymentStatus: 'unpaid', paymentMethod: 'offline', status: 'delivered', buyerType: 'retail',
  };

  it('a delivered COD retail order is an earn source (the failure scenario)', () => {
    expect(loyaltyEarnSourceFromOrder(base)).toEqual({ userId: 'u1', totalUgx: 300_000 });
    expect(loyaltyEarnSourceFromOrder({ ...base, status: 'completed' })).toEqual({ userId: 'u1', totalUgx: 300_000 });
  });

  it('an undelivered or refused COD order does not vest', () => {
    for (const status of ['received', 'processing', 'dispatched', 'delivery_failed', 'cancelled']) {
      expect(loyaltyEarnSourceFromOrder({ ...base, status }), status).toBeNull();
    }
  });

  it('a paid online order still earns; an unpaid online order never does', () => {
    expect(loyaltyEarnSourceFromOrder({ ...base, paymentMethod: 'pesapal', paymentStatus: 'paid' })).not.toBeNull();
    expect(loyaltyEarnSourceFromOrder({ ...base, paymentMethod: 'pesapal', paymentStatus: 'unpaid' })).toBeNull();
    expect(loyaltyEarnSourceFromOrder({ ...base, paymentMethod: null, paymentStatus: 'unpaid' })).toBeNull();
  });

  it('reversed money, wholesale volume and guests never earn', () => {
    expect(loyaltyEarnSourceFromOrder({ ...base, paymentStatus: 'reversed' })).toBeNull();
    expect(loyaltyEarnSourceFromOrder({ ...base, buyerType: 'wholesale' })).toBeNull();
    expect(loyaltyEarnSourceFromOrder({ ...base, paymentStatus: 'paid', buyerType: 'corporate' })).toBeNull();
    expect(loyaltyEarnSourceFromOrder({ ...base, userId: null })).toBeNull();
    expect(loyaltyEarnSourceFromOrder(null)).toBeNull();
  });

  it('the payment rule matches the SQL twin used by every other loyalty query', () => {
    expect(loyaltyPaymentQualifies('paid', 'pesapal')).toBe(true);
    expect(loyaltyPaymentQualifies('unpaid', 'offline')).toBe(true);
    expect(loyaltyPaymentQualifies('reversed', 'offline')).toBe(false);
    expect(loyaltyPaymentQualifies('unpaid', 'pesapal')).toBe(false);
    const sqlTwin = read('apps/api/src/infrastructure/db/LoyaltyEarnEligibilitySql.ts');
    expect(sqlTwin).toContain(`(payment_status = 'paid' or (payment_method = 'offline' and payment_status <> 'reversed'))`);
  });

  it('the vesting source, referrals, missions, guest backfill and pending projection share the rule', () => {
    const orderRepo = read('apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts');
    const fn = orderRepo.slice(orderRepo.indexOf('async findLoyaltyEarnSource('), orderRepo.indexOf('async findAll('));
    expect(fn).toContain('paymentMethod: orders.paymentMethod');
    expect(fn).toContain('status: orders.status');
    expect(fn).toContain('loyaltyEarnSourceFromOrder(row)');
    for (const [file, n] of [
      ['apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyReferralRepository.ts', 1],
      ['apps/api/src/infrastructure/db/repositories/DrizzleGamificationRepository.ts', 2],
      ['apps/api/src/infrastructure/loyalty/LoyaltyIdentityInfrastructure.ts', 1],
      ['apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyCompletionRepository.ts', 1],
    ] as const) {
      const src = read(file);
      expect(src.split('${LOYALTY_PAYMENT_QUALIFIES_SQL}').length - 1, file).toBe(n);
      expect(src, file).not.toMatch(/payment_status = 'paid'\s*\n\s*and status in/);
      expect(src, file).not.toMatch(/and payment_status = 'paid'\s*\n\s*and status in \('delivered'/);
    }
  });
});

// ------------------------------------------------------------------ 2. media
describe('an upload is stored under the extension its bytes earned', () => {
  const GIF_1x1 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
  const polyglot = Buffer.concat([GIF_1x1, Buffer.from('<html><script>alert(document.domain)</script></html>')]);

  it('names the file from the sniffed type, never the client extension', () => {
    expect(storedImageFilename('promo.html', 'image/gif')).toBe('promo.gif');
    expect(storedImageFilename('x.png.html', 'image/gif')).toBe('x.png.gif');
    expect(storedImageFilename('photo.JPEG', 'image/jpeg')).toBe('photo.jpg');
    expect(storedImageFilename('shot', 'image/webp')).toBe('shot.webp');
    expect(storedImageFilename('.htaccess', 'image/png')).toBe('htaccess.png');
    expect(storedImageFilename('..', 'image/png')).toBe('upload.png');
    expect(storedImageFilename('bad name?.svg', 'image/avif')).toBe('bad_name_.avif');
    expect(storedImageFilename(`${'a'.repeat(400)}.png`, 'image/png').length).toBeLessThanOrEqual(200);
  });

  it('a GIF/HTML polyglot named .html is stored and served as .gif', async () => {
    const saved: string[] = [];
    const created: Array<{ filename: string; url: string; mime: string }> = [];
    const repo = {
      findByChecksum: async () => null,
      create: async (input: { filename: string; url: string; mime: string }) => { created.push(input); return { id: 'a1', ...input, variants: [] }; },
      addVariants: async () => undefined,
      findById: async () => null,
    };
    const storage = {
      saveAsset: async (dir: string, name: string) => { saved.push(name); return { url: `/${dir}/${name}`, storageKey: `${dir}/${name}`, physicalPath: `/x/${dir}/${name}` }; },
      deleteByKey: async () => undefined,
    };
    const variants = { generate: async () => ({ width: 1, height: 1, variants: [] }) };
    const useCase = new MediaLibraryUseCase(repo as never, storage, variants as never, { assignAsCover: async () => ({ ok: true as const }) });
    const [outcome] = await useCase.upload({ files: [{ filename: 'promo.html', mime: 'text/html', buffer: polyglot }], actorId: 'u1' });
    expect(outcome.kind).toBe('STORED');
    expect(saved).toEqual(['promo.gif']);
    expect(created[0].url).toMatch(/\/promo\.gif$/);
    expect(created[0].mime).toBe('image/gif');
  });

  it('the edge serves /uploads/* with a sandboxing CSP and nosniff', () => {
    const caddy = read('Caddyfile');
    const block = caddy.slice(caddy.indexOf('handle /uploads/*'), caddy.indexOf('file_server', caddy.indexOf('handle /uploads/*')));
    expect(block).toMatch(/header Content-Security-Policy "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"/);
    expect(block).toMatch(/header X-Content-Type-Options "nosniff"/);
  });
});

// ---------------------------------------------------------- 3. editor stock
describe('a product editor save never reverts stock moved since the page loaded', () => {
  it('plans: unchanged → skip, changed → compare-and-set, no expected → legacy write', () => {
    expect(planEditorStockWrite(5, 5)).toEqual({ kind: 'SKIP' });
    expect(planEditorStockWrite(7, 5)).toEqual({ kind: 'WRITE', expectedStock: 5 });
    expect(planEditorStockWrite(7, null)).toEqual({ kind: 'WRITE', expectedStock: null });
    expect(planEditorStockWrite(7, undefined)).toEqual({ kind: 'WRITE', expectedStock: null });
  });

  function stockUseCase(initial: number) {
    const state = { stock: initial, reserved: 0, calls: [] as Array<{ newStock: number; expected: number | null | undefined }> };
    const repo = {
      setStockQuantity: async (_id: string, newStock: number, expected?: number | null) => {
        state.calls.push({ newStock, expected });
        if (expected != null && state.stock !== expected) return { applied: false, reserved: state.reserved, stock: state.stock, stale: true };
        state.stock = newStock;
        return { applied: true, reserved: state.reserved, stock: state.stock };
      },
    };
    return { state, useCase: new SetProductStockUseCase(repo as never) };
  }

  it('the failure scenario: loaded 5, dispatched to 3, price-only save keeps 3', async () => {
    const { state, useCase } = stockUseCase(5);
    state.stock = 3; // two units dispatched after the editor loaded
    const outcome = await useCase.executeFromEditor('p1', 5, 5);
    expect(outcome).toEqual({ kind: 'SKIPPED' });
    expect(state.calls).toEqual([]);
    expect(state.stock).toBe(3);
  });

  it('an edited quantity against moved stock is refused as stale, not applied', async () => {
    const { state, useCase } = stockUseCase(5);
    state.stock = 3;
    const outcome = await useCase.executeFromEditor('p1', 9, 5);
    expect(outcome).toMatchObject({ kind: 'WRITE', result: { applied: false, stale: true, stock: 3 } });
    expect(state.stock).toBe(3);
  });

  it('an edited quantity against unmoved stock applies', async () => {
    const { state, useCase } = stockUseCase(5);
    const outcome = await useCase.executeFromEditor('p1', 9, 5);
    expect(outcome).toMatchObject({ kind: 'WRITE', result: { applied: true, stock: 9 } });
    expect(state.calls).toEqual([{ newStock: 9, expected: 5 }]);
  });

  it('the route, repository and editor carry the loaded quantity', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/products.ts');
    const put = route.slice(route.indexOf("routes.put('/:id'"), route.indexOf('// ── Focus 4: product gallery'));
    expect(put).toContain('setProductStockUseCase.executeFromEditor(productId, stockQuantity, expectedStockQuantity)');
    expect(put).toContain("code: 'STALE_STOCK'");
    expect(put).toMatch(/previousState: \{[\s\S]*stockQuantity: existingProduct\.stockQuantity/);
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository.ts');
    expect(repo).toContain('eq(products.stockQuantity, expectedStock)');
    const editor = read('apps/web/src/pages/admin/products/[id]/edit-properties.astro');
    expect(editor).toContain('<input type="hidden" name="expectedStockQuantity" value={String(product.stockQuantity)} />');
    // imageUrl left the body on 2026-09-24 (the free-text image field is retired).
    expect(editor).toMatch(/stockQuantity, expectedStockQuantity, active/);
  });
});

// ------------------------------------------------------------ 4. stock count
describe('a stock count applies once, and sets the balance under the lock', () => {
  function countLedger() {
    const state = { stock: 10, reserved: 0, status: 'DRAFT', appliedBy: null as string | null, movements: [] as Array<{ delta: number; before: number; after: number }> };
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const repo = {
      findCount: async () => ({
        id: 'c1', countType: 'CYCLE', locationId: null, status: state.status, notes: null, createdBy: 'u', createdAt: new Date(0), appliedBy: state.appliedBy, appliedAt: null,
        lines: [{ id: 'l1', productId: 'p1', canonicalCode: 'BL-5C', productName: 'BL-5C', systemQuantity: 10, countedQuantity: 8, reason: 'shelf count', movementId: null }],
      }),
      currentStock: async () => { await tick(); return { stock: state.stock, reserved: state.reserved }; },
      claimCountForApply: async (_id: string, actor: string) => {
        if (state.status !== 'DRAFT' || state.appliedBy !== null) return false;
        state.appliedBy = actor;
        return true;
      },
      applyMovement: async (w: { delta: number; targetQuantity?: number | null }) => {
        await tick();
        const delta = w.targetQuantity != null ? w.targetQuantity - state.stock : w.delta;
        const before = state.stock;
        state.stock += delta;
        state.movements.push({ delta, before, after: state.stock });
        return { ok: true, movement: { id: `m${state.movements.length}` }, before, after: state.stock, reserved: 0 };
      },
      defaultLocation: async () => null,
      markCount: async () => { if (state.status === 'DRAFT') state.status = 'APPLIED'; return { id: 'c1', status: state.status }; },
    };
    const useCase = new InventoryLedgerUseCases(repo as never, {} as never, { save: async () => undefined } as never);
    return { state, useCase };
  }

  it('three concurrent applies of "8" against 10 leave 8, with one movement (the failure scenario)', async () => {
    const { state, useCase } = countLedger();
    const results = await Promise.allSettled([useCase.applyCount('c1', 'a'), useCase.applyCount('c1', 'a'), useCase.applyCount('c1', 'a')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(state.stock).toBe(8);
    expect(state.movements).toEqual([{ delta: -2, before: 10, after: 8 }]);
  });

  it('a double-submitted manual COUNT movement sets the balance once, not the difference twice', async () => {
    const { state, useCase } = countLedger();
    const input = { productId: 'p1', movementType: 'COUNT', quantity: 8, reason: 'shelf count', actorId: 'a', canRecordCost: false };
    await Promise.all([useCase.recordMovement(input), useCase.recordMovement(input)]);
    expect(state.stock).toBe(8);
    expect(state.movements.map((m) => m.delta)).toEqual([-2, 0]);
  });

  it('the claim and the settle are conditional in SQL', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleInventoryLedgerRepository.ts');
    expect(repo).toMatch(/eq\(stockCounts\.status, 'DRAFT'\), isNull\(stockCounts\.appliedBy\)/);
    const mark = repo.slice(repo.indexOf('async markCount('));
    expect(mark).toMatch(/and\(eq\(stockCounts\.id, id\), eq\(stockCounts\.status, 'DRAFT'\)\)/);
    expect(repo).toContain('write.targetQuantity != null ? write.targetQuantity - row.stock : write.delta');
    const uc = read('apps/api/src/application/use-cases/batteries/InventoryLedgerUseCases.ts');
    const body = uc.slice(uc.indexOf('async applyCount('), uc.indexOf('async cancelCount('));
    expect(body.indexOf('claimCountForApply')).toBeGreaterThan(-1);
    expect(body.indexOf('claimCountForApply')).toBeLessThan(body.indexOf('applyMovement'));
    // Every balance-setting movement (manual, import, rollback) goes through the lock.
    expect(uc).toContain("targetQuantity: type === 'COUNT' || type === 'CORRECTION' ? input.quantity : null");
  });
});

describe('a count with a refused line is not left stuck', () => {
  // Two lines; the second is refused (BELOW_RESERVED) until the reservation is
  // released. Before the fix the refusal left the count DRAFT and claimed:
  // "already being applied" on retry, COUNT_NOT_DRAFT on cancel, forever.
  function stuckLedger() {
    const stock: Record<string, { stock: number; reserved: number }> = { p1: { stock: 10, reserved: 0 }, p2: { stock: 5, reserved: 3 } };
    const state = { status: 'DRAFT', appliedBy: null as string | null, movements: [] as Array<{ productId: string; before: number; after: number }>, releases: 0 };
    const repo = {
      findCount: async () => ({
        id: 'c1', countType: 'CYCLE', locationId: null, status: state.status, notes: null, createdBy: 'u', createdAt: new Date(0), appliedBy: state.appliedBy, appliedAt: null,
        lines: [
          { id: 'l1', productId: 'p1', canonicalCode: 'BL-5C', productName: 'BL-5C', systemQuantity: 10, countedQuantity: 8, reason: 'shelf count', movementId: null },
          { id: 'l2', productId: 'p2', canonicalCode: 'BL-4C', productName: 'BL-4C', systemQuantity: 5, countedQuantity: 1, reason: 'shelf count', movementId: null },
        ],
      }),
      currentStock: async (productId: string) => ({ ...stock[productId] }),
      claimCountForApply: async (_id: string, actor: string) => {
        if (state.status !== 'DRAFT' || state.appliedBy !== null) return false;
        state.appliedBy = actor;
        return true;
      },
      releaseCountClaim: async (_id: string, actor: string) => {
        // The SQL: WHERE id AND status = 'DRAFT' AND applied_by = actor.
        if (state.status === 'DRAFT' && state.appliedBy === actor) { state.appliedBy = null; state.releases++; }
      },
      applyMovement: async (w: { productId: string; delta: number; targetQuantity?: number | null }) => {
        const row = stock[w.productId];
        const after = w.targetQuantity != null ? w.targetQuantity : row.stock + w.delta;
        if (after < row.reserved) return { ok: false, code: 'BELOW_RESERVED', message: `Refused: ${row.reserved} unit(s) are reserved.` };
        state.movements.push({ productId: w.productId, before: row.stock, after });
        const before = row.stock;
        row.stock = after;
        return { ok: true, movement: { id: `m${state.movements.length}` }, before, after, reserved: row.reserved };
      },
      markCount: async (_id: string, status: 'APPLIED' | 'CANCELLED') => {
        // The SQL: APPLIED needs DRAFT; CANCELLED needs DRAFT and no claim.
        if (state.status === 'DRAFT' && (status === 'APPLIED' || state.appliedBy === null)) state.status = status;
        return { id: 'c1', status: state.status };
      },
    };
    const useCase = new InventoryLedgerUseCases(repo as never, {} as never, { save: async () => undefined } as never);
    return { stock, state, useCase };
  }

  it('the refusal releases the claim, and the count can be applied again once the cause is fixed', async () => {
    const { stock, state, useCase } = stuckLedger();
    await expect(useCase.applyCount('c1', 'a')).rejects.toMatchObject({ code: 'BELOW_RESERVED' });
    expect(state.status).toBe('DRAFT');
    expect(state.appliedBy).toBeNull();
    expect(state.releases).toBe(1);
    // The first line already posted; the reservation is then released.
    expect(stock.p1.stock).toBe(8);
    stock.p2.reserved = 0;
    const applied = await useCase.applyCount('c1', 'a');
    expect(applied).toMatchObject({ status: 'APPLIED' });
    // A COUNT sets the balance, so re-applying the first line changes nothing.
    expect(stock).toEqual({ p1: { stock: 8, reserved: 0 }, p2: { stock: 1, reserved: 0 } });
  });

  it('the refused count can be cancelled instead', async () => {
    const { state, useCase } = stuckLedger();
    await expect(useCase.applyCount('c1', 'a')).rejects.toMatchObject({ code: 'BELOW_RESERVED' });
    const cancelled = await useCase.cancelCount('c1', 'a', 'recount next week');
    expect(cancelled).toMatchObject({ status: 'CANCELLED' });
    expect(state.status).toBe('CANCELLED');
  });

  it('a count claimed by an apply in progress still cannot be cancelled', async () => {
    const { state, useCase } = stuckLedger();
    state.appliedBy = 'someone-else';
    await expect(useCase.cancelCount('c1', 'a', 'oops')).rejects.toMatchObject({ code: 'COUNT_NOT_DRAFT' });
    expect(state.status).toBe('DRAFT');
  });

  it('the release is conditional on the holder, in SQL', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleInventoryLedgerRepository.ts');
    const release = repo.slice(repo.indexOf('async releaseCountClaim('), repo.indexOf('async markCount('));
    expect(release).toMatch(/appliedBy: null/);
    expect(release).toMatch(/eq\(stockCounts\.status, 'DRAFT'\), eq\(stockCounts\.appliedBy, actorId\)/);
  });
});
