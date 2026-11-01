import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs migration 0061 verbatim against a REAL PostgreSQL 16 and then exercises
 * the repositories through it. Two things are being proven that a double
 * cannot show: that the migration's SQL and CHECK constraints are valid and
 * actually reject bad rows, and that ownership scoping is enforced by the
 * query rather than by a caller remembering to filter.
 *
 * Set ANALYTICS_TEST_DATABASE_URL to run; otherwise the suite reports skipped.
 */
const URL = process.env.ANALYTICS_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

suite('analytics configuration repositories (real PostgreSQL, migration 0061)', () => {
  let views: import('../../apps/api/src/application/ports/IAnalyticsConfigRepository').IAnalyticsSavedViewRepository;
  let rules: import('../../apps/api/src/application/ports/IAnalyticsConfigRepository').IAnalyticsAlertRuleRepository;
  let client: any;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const dbModule = await import('../../apps/api/src/infrastructure/db/client');
    client = dbModule.client;
    closeDb = async () => { await client.end({ timeout: 5 }); };

    const migration = readFileSync(
      resolve(__dirname, '../../apps/api/src/infrastructure/db/migrations/0061_analytics_saved_views_and_alert_rules.sql'),
      'utf8',
    );
    await client.unsafe('drop table if exists analytics_saved_views, analytics_alert_rules');
    await client.unsafe(migration);

    const repos = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAnalyticsConfigRepositories');
    views = new repos.DrizzleAnalyticsSavedViewRepository();
    rules = new repos.DrizzleAnalyticsAlertRuleRepository();
  });

  afterAll(async () => {
    await closeDb?.();
  });

  it('applies the migration and creates both tables with their constraints', async () => {
    const tables = await client`
      select table_name from information_schema.tables
      where table_name in ('analytics_saved_views', 'analytics_alert_rules')
      order by table_name`;
    expect(tables.map((t: any) => t.table_name)).toEqual(['analytics_alert_rules', 'analytics_saved_views']);
  });

  it('refuses a saved view with no window at all', async () => {
    await expect(client`
      insert into analytics_saved_views (owner_id, name, scope) values (${OWNER}, 'no window', 'PRIVATE')
    `).rejects.toThrow(/analytics_saved_views_window_check/);
  });

  it('refuses an alert rule with a zero minimum sample', async () => {
    await expect(client`
      insert into analytics_alert_rules (owner_id, name, metric_key, comparison, threshold, minimum_sample)
      values (${OWNER}, 'no floor', 'payment_failure_rate', 'ABOVE', 0.2, 0)
    `).rejects.toThrow(/minimum_sample_check/);
  });

  it('refuses an unknown comparison and an unknown scope', async () => {
    await expect(client`
      insert into analytics_alert_rules (owner_id, name, metric_key, comparison, threshold, minimum_sample)
      values (${OWNER}, 'bad comparison', 'orders', 'SIDEWAYS', 1, 5)
    `).rejects.toThrow(/comparison_check/);
    await expect(client`
      insert into analytics_saved_views (owner_id, name, scope, period_days)
      values (${OWNER}, 'bad scope', 'PUBLIC', 30)
    `).rejects.toThrow(/scope_check/);
  });

  it('hides another operator’s private view but shows a shared one', async () => {
    await views.create({ ownerId: OTHER, name: 'their private', scope: 'PRIVATE', periodDays: 30, metricKeys: ['orders'] });
    const shared = await views.create({ ownerId: OTHER, name: 'their shared', scope: 'SHARED', periodDays: 30, metricKeys: ['orders'] });

    const visible = await views.listVisibleTo(OWNER, 50);
    expect(visible.map((v) => v.name)).toEqual(['their shared']);
    expect(await views.findVisible(shared.id, OWNER)).not.toBeNull();
  });

  it('cannot update or delete a view owned by someone else', async () => {
    const theirs = await views.create({ ownerId: OTHER, name: 'untouchable', scope: 'PRIVATE', periodDays: 7, metricKeys: ['orders'] });
    expect(await views.updateOwned(theirs.id, OWNER, { name: 'hijacked' })).toBeNull();
    expect(await views.deleteOwned(theirs.id, OWNER)).toBe(false);
    const [row] = await client`select name from analytics_saved_views where id = ${theirs.id}`;
    expect(row.name).toBe('untouchable');
  });

  it('enforces one view name per owner but allows the same name for another owner', async () => {
    await views.create({ ownerId: OWNER, name: 'weekly', scope: 'PRIVATE', periodDays: 7, metricKeys: ['orders'] });
    await expect(views.create({ ownerId: OWNER, name: 'weekly', scope: 'PRIVATE', periodDays: 7, metricKeys: ['orders'] }))
      .rejects.toThrow(/owner_name_idx|duplicate key/);
    const other = await views.create({ ownerId: OTHER, name: 'weekly', scope: 'PRIVATE', periodDays: 7, metricKeys: ['orders'] });
    expect(other.id).toBeTruthy();
  });

  it('round-trips an alert rule and records evaluation without a delivery path', async () => {
    const rule = await rules.create({
      ownerId: OWNER, name: 'failures', metricKey: 'payment_failure_rate',
      comparison: 'ABOVE', threshold: 0.2, minimumSample: 5,
      evaluationDays: 7, severity: 'HIGH', cooldownMinutes: 720,
    });
    expect(rule.enabled).toBe(true);
    expect(rule.lastFiredAt).toBeNull();

    await rules.recordEvaluation(rule.id, new Date('2026-08-02T00:00:00Z'), true);
    const after = await rules.findOwned(rule.id, OWNER);
    expect(after?.lastFiredAt?.toISOString()).toBe('2026-08-02T00:00:00.000Z');

    // The table has no column that could carry a destination.
    const columns = await client`
      select column_name from information_schema.columns where table_name = 'analytics_alert_rules'`;
    const names = columns.map((c: any) => c.column_name).join(',');
    for (const forbidden of ['email', 'phone', 'recipient', 'destination', 'channel', 'webhook', 'provider']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('lists only enabled rules for the evaluation sweep', async () => {
    const disabled = await rules.create({
      ownerId: OWNER, name: 'disabled watch', metricKey: 'orders',
      comparison: 'BELOW', threshold: 1, minimumSample: 5,
      evaluationDays: 7, severity: 'LOW', cooldownMinutes: 0,
    });
    await rules.updateOwned(disabled.id, OWNER, { enabled: false });
    const enabled = await rules.listEnabled(50);
    expect(enabled.some((r) => r.id === disabled.id)).toBe(false);
  });
});
