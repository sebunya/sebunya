import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAVED_PRODUCTS_CAP, SavedProductsUseCases } from '../../apps/api/src/application/use-cases/account/SavedProductsUseCases';

const PID = '0f1e2d3c-4b5a-4978-8a9b-0c1d2e3f4a5b';
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
function repo(initial: string[] = []) {
  const set = new Set(initial);
  return {
    set,
    list: async () => [...set],
    add: async (_u: string, p: string) => { set.add(p); return 'added' as const; },
    remove: async (_u: string, p: string) => { set.delete(p); },
    has: async (_u: string, p: string) => set.has(p),
    count: async () => set.size,
  };
}

describe('Save for later (gap #6)', () => {
  it('saves, reports, removes; junk ids never reach the database', async () => {
    const r = repo();
    const uc = new SavedProductsUseCases(r, { findPublicViewList: async () => [] } as never);
    expect(await uc.save('u', PID)).toBe('saved');
    expect(await uc.isSaved('u', PID)).toBe(true);
    await uc.remove('u', PID);
    expect(await uc.isSaved('u', PID)).toBe(false);
    expect(await uc.save('u', 'not-a-uuid')).toBe('invalid');
    expect(r.set.size).toBe(0);
  });

  it(`stops at ${SAVED_PRODUCTS_CAP}, but saving one already there still works`, async () => {
    const ids = Array.from({ length: SAVED_PRODUCTS_CAP }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const uc = new SavedProductsUseCases(repo(ids), { findPublicViewList: async () => [] } as never);
    expect(await uc.save('u', PID)).toBe('full');
    expect(await uc.save('u', ids[0])).toBe('saved');
  });

  it('only approved, active products can be saved, at the database', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleWishlistRepository.ts')).toContain("p.approval_status = 'approved' and p.active = true");
  });

  it('a guest is sent to sign in and back to the product; the page offers it on every product', () => {
    const relay = read('apps/web/src/pages/api/saved.ts');
    expect(relay).toContain('if (!token) return redirect(`/login?returnTo=${encodeURIComponent(back)}`, 303);');
    expect(relay).toContain('/^\\/(products\\/[a-z0-9-]+|account\\/saved)$/i');
    expect(read('apps/web/src/pages/products/[slug].astro')).toContain('data-save-for-later');
    expect(read('apps/web/src/components/AccountNav.astro')).toContain("{ key: 'saved', href: '/account/saved', label: 'Saved' }");
  });
});
