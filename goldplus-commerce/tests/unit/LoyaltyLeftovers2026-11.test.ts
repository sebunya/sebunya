import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { otpRandom } from '../../apps/api/src/infrastructure/loyalty/LoyaltyIdentityInfrastructure';

/**
 * The last open findings of the gift-card/loyalty review chunks (PRs #214-#216,
 * 2026-11): everything else in them shipped in PR #244.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('draw budget edit reads one campaign (review 215 #9)', () => {
  it('uses findCampaignById, not the full stats listing', () => {
    const src = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
    const budgetRoute = src.slice(src.indexOf("routes.put('/draws/:id/budget'"));
    const routeBody = budgetRoute.slice(0, budgetRoute.indexOf('\n});'));
    expect(routeBody).toContain('findCampaignById(campaignId)');
    expect(routeBody).not.toContain('listCampaignsWithStats');
    // The refusal below what is already paid out still reads the same fields.
    expect(routeBody).toContain("code: 'BELOW_SPENT'");
    expect(routeBody).toContain('campaign.pointsAwarded');
  });
});

describe('OTP codes cover the whole six-digit range (review 215 #10)', () => {
  it('999999 is a possible code and nothing is shorter than six digits', () => {
    const src = read('apps/api/src/infrastructure/loyalty/LoyaltyIdentityInfrastructure.ts');
    expect(src).toContain('randomInt(100000, 1_000_000)');
    for (let i = 0; i < 500; i++) expect(otpRandom()).toMatch(/^[1-9]\d{5}$/);
  });
});

describe('the loyalty pages share one programme shape and one loader (review 216)', () => {
  const lib = read('apps/web/src/lib/loyaltyProgramme.ts');
  it('the loader fetches the programme and the draw in parallel', () => {
    expect(lib).toContain('Promise.all([');
    expect(lib).toContain('/commerce/loyalty-programme');
    expect(lib).toContain('/commerce/reward-draw');
    expect(lib).toContain("json.data?.active ? (json.data as Programme) : null");
  });
  for (const page of ['apps/web/src/pages/loyalty.astro', 'apps/web/src/pages/loyalty-terms.astro']) {
    it(`${page} imports the shared loader and declares no Programme of its own`, () => {
      const src = read(page);
      expect(src).toContain("from \"../lib/loyaltyProgramme\"");
      expect(src).toContain('loadProgrammeAndDraw()');
      expect(src).not.toMatch(/interface Programme\b/);
      expect(src).not.toContain('/commerce/reward-draw');
    });
  }
  it('/loyalty resolves the session alongside the programme, not after it', () => {
    const src = read('apps/web/src/pages/loyalty.astro');
    expect(src).toMatch(/Promise\.all\(\[\s*loadProgrammeAndDraw\(\),[\s\S]*?resolveAuthenticatedUserId\(Astro\.cookies\),?\s*\]\)/);
  });
});
