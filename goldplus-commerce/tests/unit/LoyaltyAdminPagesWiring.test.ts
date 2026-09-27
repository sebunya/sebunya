import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADMIN_NAVIGATION_ITEMS } from '../../apps/web/src/lib/admin-navigation';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const tiers = read('apps/web/src/pages/admin/loyalty/tiers.astro');
const liability = read('apps/web/src/pages/admin/loyalty/liability.astro');
const hub = read('apps/web/src/pages/admin/loyalty.astro');
const proxy = read('apps/web/src/pages/api/admin/loyalty/finance-export.csv.ts');

describe('loyalty tiers page', () => {
  it('requires a session and reads/saves through the tier endpoints', () => {
    expect(tiers).toContain('Astro.redirect("/admin/login?returnTo=/admin/loyalty/tiers", 303)');
    expect(tiers).toContain('${apiBase}/admin/loyalty/tiers`');
    expect(tiers).toContain('/admin/loyalty/tiers/${encodeURIComponent(code)}');
    expect(tiers).toContain('method: "PUT"');
  });
  it('shows dormant state and gates evaluation on an active programme', () => {
    expect(tiers).toContain('data-programme-state="dormant"');
    expect(tiers).toContain('LOYALTY_PROGRAMME_ENABLED');
    expect(tiers).toMatch(/if \(!programme\?\.active\)/);
  });
});

describe('loyalty liability page', () => {
  it('reads the liability endpoint and offers the finance CSV via a same-origin proxy', () => {
    expect(liability).toContain('${apiBase}/admin/loyalty/liability`');
    expect(liability).toContain('href="/api/admin/loyalty/finance-export.csv"');
    expect(proxy).toContain('${apiBase}/admin/loyalty/finance-export.csv`');
    expect(proxy).toContain('Authorization: `Bearer ${token}`');
  });
  it('shows an explicit error instead of figures when the API fails', () => {
    expect(liability).toContain('No figures are shown in its place.');
    expect(liability).toContain('data-programme-state="dormant"');
  });
});

describe('loyalty hub and navigation', () => {
  it('links the new pages', () => {
    expect(hub).toContain('href="/admin/loyalty/tiers"');
    expect(hub).toContain('href="/admin/loyalty/liability"');
    const hrefs = ADMIN_NAVIGATION_ITEMS.map((i: { href: string }) => i.href);
    expect(hrefs).toContain('/admin/loyalty/tiers');
    expect(hrefs).toContain('/admin/loyalty/liability');
  });
  it('never falls back to static preview numbers', () => {
    expect(hub).not.toContain('LOYALTY_ADMIN_PREVIEW');
  });
});
