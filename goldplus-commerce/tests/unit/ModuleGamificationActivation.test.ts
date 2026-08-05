import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Gamification activation boundary (0087).
 *
 * Era-pin: gamification went LIVE on 2026-08-05. These assertions protect the
 * properties that make that safe — every award idempotent and ledger-backed,
 * every mutating admin action permissioned, chance mechanics still absent, and
 * the customer copy generated from live config rather than typed into prose.
 */
const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const migration = read('apps/api/src/infrastructure/db/migrations/0087_loyalty_gamification_live.sql');
const engine = read('apps/api/src/application/use-cases/loyalty/LoyaltyGamificationUseCases.ts');
const registry = read('apps/api/src/infrastructure/Registry.ts');
const governance = read('apps/api/src/interfaces/http/routes/governance.ts');
const account = read('apps/api/src/interfaces/http/routes/account.ts');
const terms = read('apps/web/src/pages/loyalty-terms.astro');
const loyaltyPage = read('apps/web/src/pages/loyalty.astro');
const journal = read('apps/api/src/infrastructure/db/migrations/meta/_journal.json');

describe('0087 migration', () => {
  it('is registered in the journal', () => {
    expect(journal).toContain('0087_loyalty_gamification_live');
  });

  it('is additive — it creates and alters, and never drops a table or column', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS "loyalty_referrals"/);
    // Comment lines carry the documented ROLLBACK recipe, which names DROPs it
    // does not perform — assert against executable SQL only.
    const executable = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(executable).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(executable).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(executable).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('structurally forbids self-referral and double-referral at the database level', () => {
    expect(migration).toContain('loyalty_referrals_no_self_check');
    expect(migration).toContain('loyalty_referrals_referee_uq');
  });

  it('activates only the three approved non-order earn rules', () => {
    expect(migration).toContain("'verification_scan', 1, 'event', 25");
    expect(migration).toContain("'counterfeit_report', 1, 'event', 250");
    expect(migration).toContain("'phone_verification', 1, 'event', 100");
  });

  it('keeps tier benefits SERVICE-based, never a discount that would double the liability', () => {
    expect(migration).toContain('prioritySupport');
    expect(migration).toContain('extendedWarrantyHandling');
    expect(migration).not.toMatch(/"discount(Percent|Bps|Ugx)"/i);
  });

  it('ships exactly three ACTIVE missions — the brief says two or three, not ten', () => {
    expect(migration).toContain('INSERT INTO "gamification_missions"');
    // Every seeded mission row is ACTIVE, and there are exactly three of them.
    expect((migration.match(/'ACTIVE'\)/g) ?? []).length).toBe(3);
    const missionKeys = new Set(migration.match(/'(five_deliveries|verify_ten|order_streak_3)'/g) ?? []);
    expect(missionKeys.size).toBe(3);
  });

  it('leaves chance-based mechanics OFF — the PART P legal read still gates them', () => {
    expect(migration).toContain('"chance_enabled" boolean DEFAULT false NOT NULL');
    expect(migration).not.toMatch(/scratch|spin|wheel|lottery/i);
    expect(migration).not.toMatch(/UPDATE "loyalty_config" SET[\s\S]{0,400}"chance_enabled" = true/);
  });
});

describe('award integrity', () => {
  it('routes every gamification award through the append-only ledger, never a balance write', () => {
    expect(engine).not.toMatch(/update\s+.*balance/i);
    const appends = engine.match(/this\.loyalty\.append\(/g) ?? [];
    expect(appends.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every award a deterministic once-ever idempotency key', () => {
    expect(engine).toContain('idempotencyKey: `mission:${mission.key}:${input.userId}`');
    expect(engine).toContain('idempotencyKey: `referral:${referral.id}:${side}`');
    expect(engine).toContain('idempotencyKey: `birthday:${userId}:${now.getUTCFullYear()}`');
    expect(engine).toContain('idempotencyKey: `counterfeit:${input.reportId}`');
    expect(engine).toContain('idempotencyKey: `phoneverify:${input.userId}`');
  });

  it('checks the kill switch and programme gate in every earning path', () => {
    const gates = engine.match(/!config\.enabled \|\| config\.killSwitch/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(5);
  });

  it('records rule provenance so a later rate change never rewrites history', () => {
    expect(engine).toContain("ruleCode: 'mission'");
    expect(engine).toContain("ruleCode: 'referral'");
    expect(engine).toContain("ruleCode: 'birthday'");
  });
});

describe('event wiring', () => {
  it('hangs gamification off DELIVERY, the verified completion event', () => {
    expect(registry).toContain("awardBadgeByKey(source.userId, 'first_order')");
    expect(registry).toContain('evaluateGamificationForUserUseCase.execute({ userId: source.userId })');
    expect(registry).toContain('qualifyReferralOnDeliveryUseCase.execute({ orderId, refereeUserId: source.userId })');
  });

  it('never lets a gamification failure fail the order transition', () => {
    const block = registry.slice(registry.indexOf("awardBadgeByKey(source.userId, 'first_order')") - 200);
    expect(block.slice(0, 900).match(/\.catch\(\(\) => undefined\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('earns on a verification scan only when the scan actually succeeded', () => {
    expect(governance).toContain('if (successful) {');
    expect(governance).toContain("awardBadgeByKey(verified.subject, 'authenticator')");
  });

  it('puts the counterfeit-confirmation earn behind a mutating permission with an audit entry', () => {
    expect(governance).toContain("routes.patch('/admin/fake-reports/:id/status', requirePermissions([PERMISSIONS.SETTINGS_MANAGE])");
    expect(governance).toContain("action: 'FAKE_REPORT_STATUS_CHANGED'");
  });

  it('sets date of birth once only, so the birthday source cannot be cycled', () => {
    expect(account).toContain('setDateOfBirthOnce');
    expect(account).toContain("code: 'ALREADY_SET'");
  });
});

describe('0088 reward draw — the chance mechanic', () => {
  const drawMigration = read('apps/api/src/infrastructure/db/migrations/0088_loyalty_reward_draw.sql');
  const drawDomain = read('apps/api/src/domain/loyalty/RewardDraw.ts');
  const drawUseCases = read('apps/api/src/application/use-cases/loyalty/LoyaltyDrawUseCases.ts');
  const drawRepo = read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyDrawRepository.ts');
  const commerceRoutes = read('apps/api/src/interfaces/http/routes/commerce.ts');
  const rewardsPage = read('apps/web/src/pages/account/rewards.astro');

  it('is registered and additive', () => {
    expect(journal).toContain('0088_loyalty_reward_draw');
    const executable = drawMigration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(executable).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });

  it('forbids a losing outcome at the database, not just in code', () => {
    expect(drawMigration).toContain('"loyalty_draw_prizes_points_check" CHECK ("points_awarded" > 0)');
    expect(drawMigration).toContain('"loyalty_draw_results_points_check" CHECK ("points_awarded" > 0)');
  });

  it('makes one-card-per-event and one-prize-per-card structural', () => {
    expect(drawMigration).toContain('"loyalty_draw_tokens_source_uq"');
    expect(drawMigration).toContain('"loyalty_draw_results_token_uq"');
  });

  it('seeds the launch campaign INACTIVE — activation is a deliberate act', () => {
    expect(drawMigration).toMatch(/'order_delivered', 30, 200000, false\)/);
  });

  it('never uses Math.random anywhere in the prize path', () => {
    // Strip comments first — the files say "no Math.random" in prose, and the
    // assertion is about executable code.
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const source of [drawDomain, drawUseCases, drawRepo]) {
      expect(stripComments(source)).not.toMatch(/Math\.random/);
    }
    expect(registry).toContain("randomInt as nodeRandomInt } from 'node:crypto'");
    expect(registry).toContain('nodeRandomInt(maxExclusive)');
  });

  it('decides the prize on the server and never trusts a client-supplied outcome', () => {
    // The play route accepts only a token id — no prize, points or seed.
    expect(account).toContain("routes.post('/draw/play'");
    expect(account).toContain('const tokenId = String(body?.tokenId ?? \'\')');
    expect(account).not.toMatch(/body\?\.(prize|points|outcome|seed)/);
  });

  it('gates on chance_enabled AND the kill switch in every draw path', () => {
    expect((drawUseCases.match(/config\.chanceEnabled/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((drawUseCases.match(/!config\.enabled \|\| config\.killSwitch/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('claims a card with a conditional update so it cannot be played twice', () => {
    expect(drawRepo).toContain("eq(loyaltyDrawTokens.status, 'available')");
    expect(drawRepo).toContain(".set({ status: 'played'");
  });

  it('returns the card to the customer if the award fails', () => {
    expect(drawUseCases).toContain('this.draws.releaseToken(input.tokenId)');
  });

  it('routes the prize through the append-only ledger, once per card', () => {
    expect(drawUseCases).toContain('idempotencyKey: `draw:${claimed.id}`');
    expect(drawUseCases).toContain("ruleCode: 'reward_draw'");
  });

  it('publishes the odds from the same weights the engine selects on', () => {
    expect(commerceRoutes).toContain("routes.get('/reward-draw'");
    expect(commerceRoutes).toContain('publishedOdds(prizes)');
    expect(rewardsPage).toContain('Your chance of each prize');
    expect(terms.replace(/\s+/g, ' ')).toMatch(/Every card wins points/i);
  });

  it('states the no-purchase and no-cash position in the customer terms', () => {
    const prose = terms.replace(/\s+/g, ' ');
    expect(prose).toMatch(/never buy a card, and you never pay anything to play/i);
    expect(prose).toMatch(/cannot be bought, sold, transferred or exchanged for cash/i);
  });
});

describe('0089 draw activation and budget', () => {
  const activation = read('apps/api/src/infrastructure/db/migrations/0089_reward_draw_activation.sql');
  const adminRoutes = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');

  it('is registered and additive', () => {
    expect(journal).toContain('0089_reward_draw_activation');
    const executable = activation
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/\bDROP\b/i);
    expect(executable).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('sets the budget to the points equivalent of the UGX cap Rob approved', () => {
    // 500,000 UGX at the live 20 UGX point value = 25,000 points.
    expect(activation).toContain('SET "budget_cap_points" = 25000');
    expect(activation).toMatch(/500,000 UGX \/ 20 UGX per point = 25,000 points/);
  });

  it('turns on BOTH switches, so neither alone was assumed', () => {
    expect(activation).toMatch(/UPDATE "loyalty_config" SET "chance_enabled" = true/);
    expect(activation).toMatch(/SET "active" = true[\s\S]*WHERE "code" = 'delivery_scratch_v1'/);
  });

  it('brings the top-prize cap into a range that actually binds against the smaller budget', () => {
    expect(activation).toContain('SET "max_awards" = 10');
  });

  it('exposes the budget as an admin configuration value, not a code change', () => {
    expect(adminRoutes).toContain("routes.put('/draws/:id/budget'");
    expect(adminRoutes).toContain("action: 'LOYALTY_DRAW_BUDGET_CHANGED'");
    // A cap below what has already been paid out is refused.
    expect(adminRoutes).toContain("code: 'BELOW_SPENT'");
  });
});

describe('0090 compliance controls', () => {
  const compliance = read('apps/api/src/infrastructure/db/migrations/0090_draw_compliance_controls.sql');
  const drawDomain2 = read('apps/api/src/domain/loyalty/RewardDraw.ts');
  const drawUseCases2 = read('apps/api/src/application/use-cases/loyalty/LoyaltyDrawUseCases.ts');
  const adminRoutes2 = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
  const brief = read('docs/loyalty-legal-brief.md');

  it('is registered and additive', () => {
    expect(journal).toContain('0090_draw_compliance_controls');
    const executable = compliance
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(executable).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });

  it('pauses the draw as part of the migration', () => {
    expect(compliance).toMatch(/UPDATE "loyalty_config" SET "chance_enabled" = false/);
  });

  it('records WHY, citing the statutory definition that prompted it', () => {
    const prose = compliance.replace(/\s+/g, ' ');
    expect(prose).toMatch(/promotional competition/i);
    expect(prose).toMatch(/Lotteries and Gaming Act 2016/i);
    expect(prose).toMatch(/no consideration element/i);
  });

  it('seeds the honest state — no basis, so draws cannot run', () => {
    expect(compliance).toMatch(/INSERT INTO "loyalty_draw_compliance" \("basis"[\s\S]*VALUES\s*\('none', 25, 'UG'/);
  });

  it('makes a claimed basis unusable unless it is evidenced, at the database', () => {
    expect(compliance).toContain('loyalty_draw_compliance_licensed_check');
    expect(compliance).toContain('loyalty_draw_compliance_counsel_check');
    expect(compliance).toContain('loyalty_draw_compliance_ack_check');
  });

  it('defaults the minimum age to the Act’s 25-year minor threshold', () => {
    expect(compliance).toContain('"min_age" integer DEFAULT 25 NOT NULL');
  });

  it('fails closed on an unknown age and an unset basis', () => {
    expect(drawDomain2).toContain("if (!dateOfBirth) return false");
    expect(drawDomain2).toContain("if (compliance.basis === 'none') return { ok: false, reason: 'COMPLIANCE_BASIS_MISSING' }");
    expect(drawDomain2).toMatch(/LICENCE_EXPIRED/);
  });

  it('checks compliance on BOTH granting and paying out, not just granting', () => {
    expect((drawUseCases2.match(/canRunDraw\(compliance, now\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((drawUseCases2.match(/isAgeEligible\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((drawUseCases2.match(/SELF_EXCLUDED/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('refuses to activate a campaign while no compliance basis is recorded', () => {
    expect(adminRoutes2).toContain('Record a compliance basis first');
    expect(adminRoutes2).toContain("routes.put('/draws/compliance'");
    expect(adminRoutes2).toContain("action: 'LOYALTY_DRAW_COMPLIANCE_RECORDED'");
  });

  it('offers a regulatory export and customer self-exclusion', () => {
    expect(adminRoutes2).toContain("routes.get('/draws/regulatory-export.csv'");
    expect(account).toContain("routes.post('/draw/self-exclude'");
  });

  it('ships a counsel brief that states the question rather than answering it', () => {
    const prose = brief.replace(/\s+/g, ' ');
    expect(prose).toMatch(/not legal advice/i);
    expect(prose).toMatch(/promotional competition/i);
    expect(prose).toMatch(/section 64/i);
    // It must carry the finding that overturned the original design assumption.
    expect(prose).toMatch(/consideration/i);
  });
});

describe('customer copy honesty', () => {
  it('renders the loyalty terms from live programme config, not hardcoded numbers', () => {
    expect(terms).toContain('/commerce/loyalty-programme');
    expect(terms).toContain('programme.earnRatePer1000Ugx');
    expect(terms).toContain('programme.expiryDays');
    // The "not active" branch must exist so the page never invents terms.
    expect(terms).toContain('The programme is not active');
  });

  it('states the forfeiture, fair-use and rule-versioning positions the code actually implements', () => {
    const prose = terms.replace(/\s+/g, ' ');
    expect(prose).toMatch(/forfeited/i);
    expect(prose).toMatch(/30 days/);
    expect(prose).toMatch(/rule version that granted it/i);
    expect(prose).toMatch(/original expiry dates intact/i);
  });

  it('builds the ways-to-earn list from live config so an unset source is never advertised', () => {
    expect(loyaltyPage).toContain('const src = programme?.earnSources ?? null');
    expect(loyaltyPage).toContain('if (src?.verificationScan)');
    expect(loyaltyPage).toContain('This is the complete list.');
  });

  it('links the loyalty terms page from the loyalty page', () => {
    expect(loyaltyPage).toContain('/loyalty-terms');
    expect(loyaltyPage).not.toContain('dedicated loyalty terms are being prepared');
  });
});
