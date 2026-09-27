import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADMIN_NAVIGATION_ITEMS } from '../../apps/web/src/lib/admin-navigation';
import { RecomputeAllCampaignReadinessUseCase } from '../../apps/api/src/application/use-cases/campaigns/RecomputeCampaignReadinessUseCase';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const page = (name: string) => read(`apps/web/src/pages/admin/loyalty/${name}.astro`);
const loyaltyRoute = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
const campaignRoute = read('apps/api/src/interfaces/http/routes/admin/campaigns.ts');

describe('loyalty operations pages', () => {
  const pages: Array<[string, string]> = [
    ['referrals', '/admin/loyalty/referrals`'],
    ['fraud', '/admin/loyalty/fraud-signals`'],
    ['draws', '"/admin/loyalty/draws"'],
    ['adjustments', '/admin/loyalty/adjust`'],
  ];
  it.each(pages)('%s requires a session and calls its endpoint', (name, endpoint) => {
    const src = page(name);
    expect(src).toContain(`Astro.redirect("/admin/login?returnTo=/admin/loyalty/${name}", 303)`);
    expect(src).toContain('Authorization: `Bearer ${token}`');
    expect(src).toContain(endpoint);
    expect(src).toContain('role="alert"');
  });
  it('referrals and fraud show empty states', () => {
    expect(page('referrals')).toContain('No referrals have been recorded.');
    expect(page('fraud')).toContain('No fraud signals have been raised.');
  });
  it('draw activation needs an active programme and an inline confirmation, never confirm()', () => {
    const src = page('draws');
    expect(src).not.toMatch(/confirm\(/);
    expect(src).toContain('form.get("confirm") !== "yes"');
    expect(src).toContain('!programme?.active');
    expect(src).toContain('data-confirm-activation');
    expect(src).toContain('data-activation-blocked');
    expect(src).toContain('/admin/loyalty/draws/compliance');
  });
  it('manual adjust shows balance first, requires a reason and renders an idempotency key', () => {
    const src = page('adjustments');
    expect(src).toContain('/admin/loyalty/members/${encodeURIComponent(userId)}');
    expect(src).toContain('data-member-balance');
    expect(src).toContain('let idempotencyKey = crypto.randomUUID()');
    expect(src).toContain('name="idempotencyKey" value={idempotencyKey}');
    expect(src).toContain('minlength="10"');
    expect(src).toContain('Adjustments disabled: programme dormant.');
    expect(src).toContain('data-adjust-disabled');
  });
  it('member lookup endpoint sits on SETTINGS_MANAGE and reuses the history use case', () => {
    expect(loyaltyRoute).toContain("routes.get('/members/:userId', requirePermissions([PERMISSIONS.SETTINGS_MANAGE])");
    expect(loyaltyRoute).toContain('getLoyaltyHistoryUseCase.execute({ userId })');
  });
  it('pages are linked from the loyalty hub and admin navigation', () => {
    const hub = read('apps/web/src/pages/admin/loyalty.astro');
    for (const name of ['referrals', 'draws', 'fraud', 'adjustments']) {
      expect(hub).toContain(`href="/admin/loyalty/${name}"`);
      expect(ADMIN_NAVIGATION_ITEMS.some((i) => i.href === `/admin/loyalty/${name}`)).toBe(true);
    }
  });
});

describe('campaign readiness backfill', () => {
  const makeRepo = (rows: Array<{ id: string; readinessScore: number; targetUrl: string | null; utm: number }>) => {
    const stored = new Map(rows.map((r) => [r.id, r.readinessScore]));
    return {
      stored,
      list: async () => rows.map((r) => ({ id: r.id, readinessScore: stored.get(r.id)! })),
      findById: async (id: string) => {
        const r = rows.find((x) => x.id === id);
        return r ? { id, name: 'A', objective: 'B', channel: 'C', targetUrl: r.targetUrl } : null;
      },
      countUtmLinks: async (id: string) => rows.find((x) => x.id === id)!.utm,
      setReadinessScore: async (id: string, score: number) => { stored.set(id, score); },
    };
  };
  it('recomputes every campaign, counts changes and is idempotent', async () => {
    const repo = makeRepo([
      { id: 'old', readinessScore: 0, targetUrl: 'https://shopgoldplus.com/', utm: 1 },
      { id: 'draft', readinessScore: 0, targetUrl: null, utm: 0 },
      { id: 'current', readinessScore: 30, targetUrl: null, utm: 0 },
    ]);
    const uc = new RecomputeAllCampaignReadinessUseCase(repo);
    expect(await uc.execute()).toEqual({ total: 3, changed: 2 });
    expect(repo.stored.get('old')).toBe(100);
    expect(repo.stored.get('draft')).toBe(30);
    expect(await uc.execute()).toEqual({ total: 3, changed: 0 });
  });
  it('route uses the create permission and the campaigns page offers the button', () => {
    expect(campaignRoute).toContain("routes.post('/readiness/recompute', requirePermissions([PERMISSIONS.CAMPAIGNS_MANAGE])");
    expect(campaignRoute).toContain("routes.post('/', requirePermissions([PERMISSIONS.CAMPAIGNS_MANAGE])");
    const web = read('apps/web/src/pages/admin/campaigns/index.astro');
    expect(web).toContain('${apiBase}/admin/campaigns/readiness/recompute');
    expect(web).toContain('Recompute readiness');
  });
});
