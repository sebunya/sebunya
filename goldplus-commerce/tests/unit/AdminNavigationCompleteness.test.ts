import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAVIGATION, ADMIN_NAVIGATION_ITEMS } from '../../apps/web/src/lib/admin-navigation';

/**
 * Admin navigation completeness (2026-08-10).
 *
 * Before this contract, only 37 of ~79 admin surfaces were reachable from the
 * sidebar; four REAL modules were marked hidden from their stub days, and the
 * 'Other' group was never rendered at all — working pages invisible unless an
 * operator typed the URL. The rules:
 *   1. every nav href resolves to a real admin page;
 *   2. every top-level admin surface is in the nav OR on the explicit
 *      exclusion list below (sub-pages reachable from their parent, deep
 *      diagnostics, login) — silence is not an option;
 *   3. every non-hidden item belongs to a group the sidebar actually renders.
 */
const root = resolve(__dirname, '../..');
const pagesDir = join(root, 'apps/web/src/pages/admin');

/** Deliberately not in the sidebar — each with the reason it is excluded. */
const EXCLUDED: Record<string, string> = {
  '/admin/login': 'the door, not a room',
  '/admin/products/new': 'reached from Products',
  '/admin/fulfilment/report': 'reached from Fulfilment',
  '/admin/delivery/calibration': 'reached from the Delivery Control Centre',
  '/admin/delivery/launch': 'reached from the Delivery Control Centre',
  '/admin/loyalty/gamification': 'reached from Loyalty & rewards',
  '/admin/batteries/catalogue': 'reached from Batteries',
  '/admin/batteries/devices': 'reached from Batteries',
  '/admin/batteries/compatibility': 'reached from Batteries',
  '/admin/batteries/stock': 'reached from Batteries',
  '/admin/batteries/demand': 'reached from Batteries',
  '/admin/batteries/imports': 'reached from Batteries',
  '/admin/batteries/finder-settings': 'reached from Batteries',
  '/admin/measurement-control-tower': 'legacy tower; superseded by /admin/measurement',
  '/admin/measurement-handover': 'one-time handover document',
  '/admin/measurement/control-tower/controlled-activation/live-review': 'deep UAT diagnostic',
  '/admin/controlled-activation': 'UAT diagnostic',
  '/admin/controlled-activation-dry-run': 'UAT diagnostic',
  '/admin/controlled-live-canary': 'UAT diagnostic',
};

/** Top-level admin routes (dirs with index.astro + top-level .astro files). */
function topLevelAdminRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, prefix: string, depth: number) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // Dynamic segments ([id]/edit etc.) are reached from their list pages.
        if (depth < 4 && !entry.includes('[')) walk(full, `${prefix}/${entry}`, depth + 1);
      } else if (entry === 'index.astro') {
        routes.push(prefix || '/admin');
      } else if (entry.endsWith('.astro') && !entry.includes('[')) {
        routes.push(`${prefix}/${entry.replace('.astro', '')}`);
      }
    }
  };
  walk(pagesDir, '/admin', 0);
  return [...new Set(routes)].sort();
}

function pageExistsFor(href: string): boolean {
  const rel = href.replace(/^\/admin\/?/, '');
  return (
    existsSync(join(pagesDir, rel, 'index.astro')) ||
    (rel !== '' && existsSync(join(pagesDir, `${rel}.astro`))) ||
    (rel === '' && existsSync(join(pagesDir, 'index.astro')))
  );
}

describe('admin navigation completeness', () => {
  it('every nav href resolves to a real admin page', () => {
    for (const item of ADMIN_NAVIGATION_ITEMS) {
      expect(pageExistsFor(item.href), `${item.label} → ${item.href} has no page`).toBe(true);
    }
  });

  it('every top-level admin surface is in the nav or explicitly excluded with a reason', () => {
    const navHrefs = new Set(ADMIN_NAVIGATION_ITEMS.map((i) => i.href));
    const missing = topLevelAdminRoutes().filter(
      (route) => !navHrefs.has(route) && !(route in EXCLUDED),
    );
    expect(missing, `unreachable admin surfaces: ${missing.join(', ')}`).toEqual([]);
  });

  it('every non-hidden item belongs to a group the sidebar renders', () => {
    const renderedGroups = new Set(ADMIN_NAVIGATION.map((g) => g.title));
    for (const item of ADMIN_NAVIGATION_ITEMS.filter((i) => i.status !== 'hidden')) {
      expect(renderedGroups.has(item.group), `${item.label} sits in unrendered group '${item.group}'`).toBe(true);
    }
  });

  it('no rendered group is empty and none duplicates an href', () => {
    const seen = new Set<string>();
    for (const group of ADMIN_NAVIGATION) {
      expect(group.items.length, `group '${group.title}' renders empty`).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(seen.has(item.href), `duplicate nav href ${item.href}`).toBe(false);
        seen.add(item.href);
      }
    }
  });
});
