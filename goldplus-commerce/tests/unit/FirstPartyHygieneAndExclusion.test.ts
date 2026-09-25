import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { planPhoneHygiene, maskPhone, shapeOf, StoredPhone } from '../../apps/api/src/domain/first-party/PhoneHygiene';
import { EXCLUSION_RULES, resolveRuleSelection, orderRules, estimateMarkBytes } from '../../apps/api/src/domain/first-party/TrafficExclusion';
import { parseExclusionArgs, parsePhoneHygieneArgs } from '../../apps/api/src/scripts/lib/firstPartyOpsArgs';
import { humanTrafficOnly, analysisExclusionsEnabled } from '../../apps/api/src/infrastructure/first-party/AnalysisExclusion';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const rec = (table: StoredPhone['table'], raw: string, accountUserId: string | null = null, column = table === 'orders' ? 'customer_phone' : 'phone'): StoredPhone => ({ table, column, rowId: randomUUID(), raw, accountUserId });

describe('phone hygiene plan', () => {
  it('normalises mixed shapes of one number to E.164 and reports the mix', () => {
    const u = randomUUID();
    const plan = planPhoneHygiene([rec('users', '0772123456', u), rec('orders', '256772123456'), rec('orders', '+256772123456'), rec('addresses', '772 123 456', u)]);
    expect(plan.normalisations.map((n) => n.to)).toEqual(['+256772123456', '+256772123456', '+256772123456']);
    expect(plan.alreadyNormalised).toBe(1);
    expect(plan.mixedFormatGroups).toHaveLength(1);
    expect(plan.mixedFormatGroups[0].shapes).toEqual(['+256XXXXXXXXX', '0XXXXXXXXX', '256XXXXXXXXX', '7XXXXXXXX']);
    expect(plan.proposedMerges).toHaveLength(0);
  });

  it('two ACCOUNTS on one number are a proposed merge; their users.phone is never rewritten into a collision', () => {
    const a = randomUUID();
    const b = randomUUID();
    const plan = planPhoneHygiene([rec('users', '0772123456', a), rec('users', '256772123456', b), rec('orders', '0772123456')]);
    expect(plan.proposedMerges).toEqual([{ e164Masked: maskPhone('+256772123456'), accountUserIds: [a, b].sort(), reason: 'SAME_NUMBER_MULTIPLE_ACCOUNTS' }]);
    expect(plan.blocked.map((x) => x.table)).toEqual(['users', 'users']);
    expect(plan.normalisations.map((x) => x.table)).toEqual(['orders']);
  });

  it('never prints a dialable number, and leaves foreign/garbage values alone', () => {
    const plan = planPhoneHygiene([rec('quote_requests', '+14155550100'), rec('dealer_applications', 'call me')]);
    expect(plan.normalisations).toHaveLength(0);
    expect(plan.unparseable).toHaveLength(2);
    expect(JSON.stringify(plan)).not.toMatch(/4155550100/);
    expect(maskPhone('+256772123456')).toBe('+256•••••3456');
    expect(shapeOf('771234567')).toBe('7XXXXXXXX');
  });

  it('the script is a dry run by default and has no merge mode at all', () => {
    expect(parsePhoneHygieneArgs([]).mode).toBe('DRY_RUN');
    expect(parsePhoneHygieneArgs(['--apply']).mode).toBe('APPLY');
    expect(parsePhoneHygieneArgs(['--merge']).errors[0]).toMatch(/never merged/);
    expect(parsePhoneHygieneArgs(['--revert=nope']).errors).toHaveLength(1);
    const src = read('apps/api/src/scripts/phone-hygiene.ts');
    expect(src).toMatch(/Proposed merges are NOT applied/);
    expect(src).not.toMatch(/foldGuestInto|recordMerge|delete from/i);
  });

  it('apply is optimistic and logged for revert; only allowlisted columns are touched', () => {
    const repo = read('apps/api/src/infrastructure/first-party/DrizzlePhoneHygieneRepository.ts');
    expect(repo).toMatch(/and \$\{sql\.raw\(col\.column\)\} = \$\{n\.from\}/);
    expect(repo).toMatch(/insert into phone_normalisation_log/);
    expect(repo).toMatch(/PHONE_COLUMN_NOT_ALLOWLISTED/);
  });
});

describe('historical exhaust exclusion', () => {
  it('default rules exclude the huge RESPONSE log rule unless named; dependencies run first', () => {
    const d = resolveRuleSelection([]);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.rules.map((r) => r.key)).not.toContain('RESPONSE_WITHOUT_VISITOR');
      expect(d.rules.findIndex((r) => r.key === 'SINGLE_HIT_PROFILE')).toBeLessThan(d.rules.findIndex((r) => r.key === 'EVENT_OF_EXCLUDED_PROFILE'));
    }
    const named = resolveRuleSelection(['event_of_excluded_profile', 'single_hit_profile']);
    expect(named.ok && named.rules.map((r) => r.key)).toEqual(['SINGLE_HIT_PROFILE', 'EVENT_OF_EXCLUDED_PROFILE']);
    expect(resolveRuleSelection(['DELETE_EVERYTHING'])).toEqual({ ok: false, unknown: ['DELETE_EVERYTHING'] });
    expect(orderRules([...EXCLUSION_RULES]).length).toBe(EXCLUSION_RULES.length);
    expect(estimateMarkBytes(1000)).toBe(120_000);
  });

  it('the script is a dry run by default; apply and revert are explicit', () => {
    expect(parseExclusionArgs([]).mode).toBe('DRY_RUN');
    expect(parseExclusionArgs(['--apply', '--batch=1000']).mode).toBe('APPLY');
    const rid = randomUUID();
    expect(parseExclusionArgs([`--revert=${rid}`]).mode).toBe('REVERT');
    // The documented undo: --revert=<run> --apply carries the revert out; alone it is a dry run.
    expect(parseExclusionArgs(['--apply', `--revert=${rid}`])).toMatchObject({ mode: 'REVERT', applyRevert: true, errors: [] });
    expect(parseExclusionArgs([`--revert=${rid}`])).toMatchObject({ mode: 'REVERT', applyRevert: false });
    expect(parseExclusionArgs(['--batch=5']).errors[0]).toMatch(/--batch/);
    expect(parseExclusionArgs(['--from=yesterday-ish']).errors[0]).toMatch(/--from/);
    const src = read('apps/api/src/scripts/exclude-internal-traffic.ts');
    expect(src).toMatch(/Dry run: nothing was written/);
  });

  it('marks never delete or update a source row (store SQL)', () => {
    const src = read('apps/api/src/infrastructure/first-party/TrafficExclusionStore.ts');
    expect(src).not.toMatch(/delete from recommendation_events|delete from experience_profiles|update recommendation_events|update experience_profiles/i);
    expect(src).toMatch(/insert into analysis\.traffic_exclusion_marks/);
    expect(src).toMatch(/set reverted_at = now\(\)/);
  });

  it('reports read through the exclusion, with a rollback switch', () => {
    const dialect = new PgDialect();
    const q = dialect.sqlToQuery(humanTrafficOnly('recommendation_events', 'x') as any);
    expect(q.sql).toMatch(/not exists \(select 1 from analysis\.traffic_exclusion_marks m/);
    expect(q.sql).toMatch(/m\.reverted_at is null/);
    expect(analysisExclusionsEnabled({})).toBe(true);
    expect(analysisExclusionsEnabled({ ANALYSIS_EXCLUSIONS: 'off' })).toBe(false);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleRecommendationAnalyticsRepository.ts')).toMatch(/humanTrafficOnly\('recommendation_events', recommendationEvents\.id\)/);
  });
});

describe('migration 0155 is additive, journalled and complete', () => {
  const sqlText = read('apps/api/src/infrastructure/db/migrations/0155_first_party_data.sql');
  const body = sqlText.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('drops, deletes and rewrites nothing', () => {
    expect(body).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b/i);
  });

  it('is in the journal after 0154', () => {
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    const tags = journal.entries.map((e: any) => e.tag);
    expect(tags).toContain('0155_first_party_data');
    expect(tags.indexOf('0155_first_party_data')).toBeGreaterThan(tags.indexOf('0154_advertising_operations'));
  });

  it('creates every table and both filtered views', () => {
    for (const t of ['customer_identity_conflicts', 'customer_segments', 'customer_segment_members', 'customer_segment_runs', '"analysis"."traffic_exclusion_marks"', '"analysis"."traffic_exclusion_runs"', 'consent_event_evidence', 'phone_normalisation_log']) {
      expect(body).toContain(t);
    }
    expect(body).toMatch(/VIEW "analysis"\."recommendation_events_human"/);
    expect(body).toMatch(/VIEW "analysis"\."experience_profiles_human"/);
  });
});
