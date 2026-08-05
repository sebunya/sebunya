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
