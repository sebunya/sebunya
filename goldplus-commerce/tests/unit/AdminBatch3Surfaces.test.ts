import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readPaging, pagingHrefs, pagingLabel } from '../../apps/web/src/lib/adminPaging';
import { kampalaLocalToIso, formatKampala } from '../../apps/web/src/lib/kampalaTime';
import { buildProgrammePatch } from '../../apps/web/src/lib/loyaltyProgrammeForm';
import { validateHeroSlide } from '../../packages/shared/src/hero/validation';
import {
  DISPATCH_ON_TASK_STATUSES,
  GOVERNANCE_FULFILLMENT_STATUSES,
  orderFulfilmentTransitionOptions,
  orderLoadError,
} from '../../apps/web/src/lib/adminOrderPage';

/**
 * Admin sweep batch 3 (2026-09-24): admin pages that invented data, called
 * dead routes, or described the system wrongly. Each block pins one finding
 * against the real source so it cannot quietly return.
 */

const read = (p: string): string => readFileSync(p, 'utf8');
/** Source without comments: explanatory comments may name what was removed. */
const code = (p: string): string =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const WEB = 'apps/web/src';
const API = 'apps/api/src';

const walk = (dir: string, ext: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
};

describe('order pages never invent an order', () => {
  it('has no Sample John / FALLBACK order in pages/admin/orders', () => {
    for (const p of walk(`${WEB}/pages/admin/orders`, '.astro')) {
      const src = read(p).replace(/^\s*\/\/.*$/gm, '');
      expect(src, p).not.toMatch(/Sample John|GP-FALLBACK|0788000000|fallbackOrder/);
    }
  });

  it('explains a 404, a 403 and an outage differently', () => {
    expect(orderLoadError(404).title).toBe('Order not found');
    expect(orderLoadError(403).title).toMatch(/cannot read orders/);
    expect(orderLoadError(null).title).toMatch(/unreachable/);
    expect(orderLoadError(500).detail).toMatch(/HTTP 500/);
  });
});

describe('order page offers only transitions the governance route accepts', () => {
  const route = read(`${API}/interfaces/http/routes/governance.ts`);
  const m = route.match(/const allowedStatuses = \[([^\]]+)\]/);
  const routeAllowed = (m?.[1] ?? '').split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);

  it('mirrors the route list exactly', () => {
    expect(routeAllowed.length).toBeGreaterThan(0);
    expect([...GOVERNANCE_FULFILLMENT_STATUSES].sort()).toEqual([...routeAllowed].sort());
  });

  it('never offers a status the route refuses (dispatched/delivered/delivery_failed)', () => {
    const statuses = ['received', 'pending_payment', 'pending_owner_review', 'processing', 'dispatched', 'delivered', 'delivery_failed', 'completed', 'cancelled', 'failed'];
    for (const s of statuses) {
      for (const pay of ['paid', 'unpaid']) {
        for (const opt of orderFulfilmentTransitionOptions(s, pay)) {
          expect(routeAllowed, `${s} -> ${opt}`).toContain(opt);
        }
      }
    }
  });

  it('points dispatch and delivery at the fulfilment task', () => {
    expect(DISPATCH_ON_TASK_STATUSES).toEqual(expect.arrayContaining(['processing', 'dispatched', 'delivery_failed']));
    expect(read(`${API}/interfaces/http/routes/admin/fulfilment.ts`)).toMatch(/routes\.get\('\/by-order\/:orderId'/);
  });
});

describe('reports read the payments contract and the real comparison days', () => {
  const page = read(`${WEB}/pages/admin/reports/index.astro`);
  it('maps byProvider (confirmed), not a non-existent providers field', () => {
    expect(page).toMatch(/paymentsRes\.data\?\.byProvider/);
    expect(page).not.toMatch(/paymentsRes\.data\?\.providers/);
  });
  it('drops the always-empty Catalogue section and prints previousStartDay/EndDay', () => {
    expect(code(`${WEB}/pages/admin/reports/index.astro`)).not.toMatch(/\/admin\/analytics\/catalogue/);
    expect(page).toMatch(/\{period\.previousStartDay\} → \{period\.previousEndDay\}/);
  });
});

describe('cart lookup calls the route that exists', () => {
  it('uses /governance/admin/carts and no reports.read probe', () => {
    const page = code(`${WEB}/pages/admin/carts/index.astro`);
    expect(page).toMatch(/\/governance\/admin\/carts\/\$\{lookupId\}/);
    expect(page).not.toMatch(/\/commerce\/admin\/carts/);
    expect(page).not.toMatch(/governance\/admin\/stats/);
  });
});

describe('fulfilment queue pages instead of silently truncating', () => {
  it('clamps limit/offset and labels the window honestly', () => {
    const p = readPaging(new URLSearchParams('limit=999&offset=-5'));
    expect(p).toEqual({ limit: 200, offset: 0 });
    expect(pagingLabel({ limit: 50, offset: 50 }, 13, 63)).toBe('Showing 51–63 of 63');
    const hrefs = pagingHrefs(new URL('https://x/admin/fulfilment?status=PACKED'), { limit: 50, offset: 0 }, 50, 63);
    expect(hrefs.prev).toBeNull();
    expect(hrefs.next).toBe('/admin/fulfilment?status=PACKED&offset=50&limit=50');
    expect(read(`${WEB}/pages/admin/fulfilment/index.astro`)).not.toMatch(/showing \{total\}/);
  });
});

describe('admin pages stop stating things the code contradicts', () => {
  it('merchandising: hero is the CMS, rails are not curated, no isFeatured flag', () => {
    const page = read(`${WEB}/pages/admin/merchandising/index.astro`);
    expect(page).toMatch(/actionLink: "\/admin\/hero"/);
    expect(page).not.toMatch(/'isFeatured' flag\)"|Campaign scheduling API|Complete setup placement/);
  });
  it('zone policy fields say they are recorded only', () => {
    expect(read(`${WEB}/pages/admin/locations.astro`)).toMatch(/recorded policy only — delivery quoting does not read them/);
  });
  it('payments: a failed load, a search miss and an empty window are three messages', () => {
    const page = read(`${WEB}/pages/admin/payments/index.astro`);
    expect(page).toMatch(/The attempt queue could not be loaded/);
    expect(page).toMatch(/funnel\?\.ever\?\.paymentRequested === 0 \? 'No payment attempt has ever been made\.'/);
  });
  it('dealers: contact, phone, TIN and date are shown, oldest first', () => {
    const page = read(`${WEB}/pages/admin/dealers/index.astro`);
    for (const field of ['d.contactName', 'telHref(d.phone)', 'd.tinNumber', 'submitted(d.appliedAt)']) expect(page).toContain(field);
  });
  it('canary and activation shells show no invented gate state and no unbound buttons', () => {
    for (const p of [`${WEB}/components/admin/controlled-live-canary/ControlledLiveCanaryShell.astro`, `${WEB}/components/admin/controlled-activation/ControlledActivationShell.astro`]) {
      const src = code(p);
      expect(src, p).toMatch(/Not configured/);
      expect(src, p).not.toMatch(/PASSED|VERIFIED|ARMED_SAFE|admin-devops|admin-sre|<button/);
    }
  });
  it('nav editor no longer saves the three unread offer figures', () => {
    const page = read(`${WEB}/pages/admin/nav.astro`);
    expect(page).not.toMatch(/name="settings\.(firstOrderEstimateUgx|firstOrderDiscountPct|referralPct)"/);
    expect(page).toMatch(/const scalarNum = \['settings\.pointsToUgxRate'\];/);
  });
  it('system status counts the real shapes and does not call a 403 Offline', () => {
    const page = read(`${WEB}/pages/admin/system/index.astro`);
    expect(page).toMatch(/Array\.isArray\(data\?\.data\) \? data\.data\.length : 0/);
    expect(page).toMatch(/data\?\.data\?\.total \?\? data\?\.data\?\.items\?\.length/);
    expect(page).toMatch(/Not permitted to check/);
    expect(page).not.toMatch(/Active session matching enabled/);
    // Admin authentication is "Online" only when the API answered: the session
    // gate fails open during an API outage.
    expect(page).toMatch(/id: 'admin-auth'[^}]*status: 'Not checked'/);
    expect(page).toMatch(/if \(api\.status === 'Online'\) \{\s*auth\.status = 'Online'/);
  });
  it('settings names no invented deployment variables', () => {
    const page = code(`${WEB}/pages/admin/settings/index.astro`);
    expect(page).not.toMatch(/CURRENCY_DEFAULT|DEFAULT_LOCALE|key: 'PUBLIC_API_BASE_URL'|Contact operations engineering/);
  });
  it('loyalty header reads the real state and the programme values have a form', () => {
    const page = read(`${WEB}/pages/admin/loyalty.astro`);
    expect(page).toMatch(/ledgerConfig\.active/);
    expect(page).toMatch(/id="programme-values"/);
    expect(page).not.toMatch(/Activation unavailable/);
    expect(read('apps/api/src/interfaces/http/routes/admin/loyalty.ts')).toMatch(/routes\.get\('\/programme-config'/);
  });
  it('analytics quick ranges are links, not a select the dates override', () => {
    const page = read(`${WEB}/pages/admin/analytics/index.astro`);
    expect(page).not.toMatch(/<select id="analytics-days"/);
    expect(page).toMatch(/href=\{`\/admin\/analytics\?days=\$\{days\}`\}/);
  });
  it('inventory adjustments POST-redirect-GET and a failed low-stock read is not green', () => {
    const page = read(`${WEB}/pages/admin/inventory/index.astro`);
    expect(page).toMatch(/return Astro\.redirect\(target, 303\);/);
    expect(page).toMatch(/Low-stock list unavailable/);
    expect(page).not.toMatch(/Read-Only View|This view is read-only/);
  });
});

describe('a 403 is a permission gap, never a sign-out loop', () => {
  it('pages that used to clear the session on 403 now route to /admin/not-permitted', () => {
    for (const p of ['notifications/index.astro', 'roles/index.astro', 'users/index.astro', 'nav.astro', 'homepage.astro', 'business-info.astro', 'storefront-copy.astro', 'blog/index.astro', 'categories/index.astro']) {
      const src = read(`${WEB}/pages/admin/${p}`);
      expect(src, p).not.toMatch(/status === 401 \|\| \w+\.status === 403\) (return Astro\.redirect\('\/admin\/login|\{\s*Astro\.response\.headers\.set\('Set-Cookie')/);
      expect(src, p).toMatch(/\/admin\/not-permitted/);
    }
  });
});

describe('Kampala time for admin date-time inputs', () => {
  it('reads a zone-less datetime-local value as UTC+3', () => {
    expect(kampalaLocalToIso('2026-10-01T00:00')).toBe('2026-09-30T21:00:00.000Z');
    expect(kampalaLocalToIso('')).toBeNull();
    expect(kampalaLocalToIso('2026-10-01T09:00:00Z')).toBe('2026-10-01T09:00:00.000Z');
    expect(formatKampala('2026-09-30T21:00:00.000Z')).toBe('2026-10-01 00:00');
  });
  it('legal, rules and automation use it', () => {
    expect(read(`${WEB}/pages/admin/legal/index.astro`)).toMatch(/parseKampalaLocal\(effectiveAtRaw\)/);
    expect(read(`${WEB}/pages/admin/recommendations/rules/new.astro`)).toMatch(/kampalaLocalToIso\(String\(f\.get\("startsAt"\)/);
    expect(read(`${WEB}/pages/admin/automation/[id].astro`)).toMatch(/kampalaLocalToIso\(String\(form\.get\("expiresAt"\)/);
  });
});

describe('loyalty programme values send only what changed', () => {
  it('builds a PATCH of changed keys, clears an emptied number, never sends NaN', () => {
    const original = { pointValueUgx: 10, budgetCapPoints: 5000, killSwitch: false, chanceEnabled: true };
    const form = new Map<string, string>([['pointValueUgx', '10'], ['budgetCapPoints', ''], ['redemptionMinPoints', 'abc'], ['chanceEnabled', 'on']]);
    const patch = buildProgrammePatch({ get: (k) => form.get(k) ?? null }, original);
    expect(patch).toEqual({ budgetCapPoints: null, redemptionMinPoints: 'abc' });
    const kill = buildProgrammePatch({ get: (k) => (k === 'killSwitch' ? 'on' : k === 'chanceEnabled' ? 'on' : null) }, original);
    expect(kill).toEqual({ killSwitch: true });
  });
});

describe('the hero cannot re-enable the fake scratch-card offer', () => {
  it('refuses an enabled scratch / card slide and keeps a disabled one storable', () => {
    const base = { slideKey: 'scratch', media: 'card', headline: 'Scratch to win', enabled: true } as any;
    expect(validateHeroSlide(base).length).toBeGreaterThan(0);
    expect(validateHeroSlide({ ...base, enabled: false })).toEqual([]);
  });
  it('the slider has no hard-coded GP5–GP20 prize table', () => {
    const slider = read(`${WEB}/components/hero/HeroSlider.astro`);
    expect(slider).not.toMatch(/code:'GP(5|10|15|20)'|CODE GP15/);
  });
});
