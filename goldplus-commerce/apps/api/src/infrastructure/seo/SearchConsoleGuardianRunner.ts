import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import {
  SearchConsoleGuardianUseCase,
  GUARDIAN_AGENT,
  type GuardianPorts,
} from '../../application/use-cases/seo-growth/SearchConsoleGuardianUseCase';
import {
  GUARDIAN_POLICY_VERSION,
  DEFAULT_KILL_SWITCHES,
  type KillSwitches,
} from '../../application/use-cases/seo-growth/SeoGuardianPolicy';

/**
 * Binds the pure Guardian to real storage. All decision logic lives in the use
 * case; this file only reads and writes.
 *
 * Concurrency: a Postgres advisory lock is taken for the duration of the run.
 * Several API replicas share one BullMQ repeat job, but a lost lock simply
 * means another replica is already running — the invocation stands down.
 */

const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : (r as any)?.rows ?? []);

/** Stable 64-bit lock id for this agent. */
const GUARDIAN_LOCK_ID = 887_401_121;

/** Consider a RUNNING row abandoned after this long, so a crashed run recovers. */
const STALE_RUN_MINUTES = 30;

const GSC_PROVIDER_ID = 'google-search-console';

export interface GuardianRunnerOutcome {
  ran: boolean;
  runId: string | null;
  providerReadiness: string;
  phase: string | null;
  materialChanges: number;
  incidentsOpened: number;
  summary: string;
}

export async function runSearchConsoleGuardian(): Promise<GuardianRunnerOutcome> {
  const conn = db as unknown as { execute: (q: unknown) => Promise<unknown> };
  let lockHeld = false;

  const ports: GuardianPorts = {
    async providerStatus() {
      const rows = rowsOf(await conn.execute(sql`
        select c.status,
               c.property_ref,
               c.account_ref,
               exists (
                 select 1 from seo_integration_credentials cr
                 where cr.connection_id = c.id and cr.status = 'ACTIVE'
               ) as has_credential
        from seo_integration_connections c
        where c.provider_id = ${GSC_PROVIDER_ID}
        order by c.created_at desc
        limit 1
      `));
      const row = rows[0];
      if (!row) return { connectionStatus: null, hasActiveCredential: false, propertyConfigured: false };
      return {
        connectionStatus: String(row.status ?? ''),
        hasActiveCredential: row.has_credential === true,
        propertyConfigured: Boolean(row.property_ref ?? row.account_ref),
      };
    },

    async backfillComplete() {
      const rows = rowsOf(await conn.execute(sql`
        select 1 from seo_guardian_runs
        where agent = ${GUARDIAN_AGENT} and status = 'COMPLETED' and signals_evaluated = 0
          and circuit_reasons @> '[]'::jsonb
          and freshness is not null
        limit 1
      `));
      // A completed backfill is recorded as a completed run that evaluated no
      // signals but did read source data.
      return rows.length > 0;
    },

    async validLiveRunCount() {
      const rows = rowsOf(await conn.execute(sql`
        select count(*)::int as n from seo_guardian_runs
        where agent = ${GUARDIAN_AGENT} and status = 'COMPLETED' and comparison_valid = true
      `));
      return Number(rows[0]?.n ?? 0);
    },

    async runBackfill(windows) {
      // Historical context only. This deliberately does NOT notify, mutate
      // externally, open incidents or overwrite the live baseline.
      let loaded = 0;
      for (const w of windows) {
        const rows = rowsOf(await conn.execute(sql`
          select count(*)::int as n from gsc_performance
          where date >= ${w.startDate}::date and date <= ${w.endDate}::date
        `));
        if (Number(rows[0]?.n ?? 0) > 0) loaded += 1;
      }
      return { windowsLoaded: loaded };
    },

    async recordGatedRun(input) {
      await conn.execute(sql`
        update seo_guardian_runs
        set status = 'COMPLETED', finished_at = now(),
            freshness = 'UNKNOWN', comparison_valid = false,
            error = ${`${input.readiness}: ${input.reason}`}
        where id = ${input.runId}::uuid
      `);
    },

    async latestSourceDate() {
      const rows = rowsOf(await conn.execute(sql`select max(date)::text as d from gsc_performance`));
      return rows[0]?.d ?? null;
    },

    async entityWindows() {
      // Page-level clicks: last 7 settled days against the 7 before them.
      const rows = rowsOf(await conn.execute(sql`
        with bounds as (select max(date) as maxd from gsc_performance)
        select page as entity,
               sum(clicks) filter (where date > (select maxd from bounds) - 7)::int as current_clicks,
               sum(clicks) filter (where date <= (select maxd from bounds) - 7
                                     and date > (select maxd from bounds) - 14)::int as baseline_clicks
        from gsc_performance
        where date > (select maxd from bounds) - 14
        group by page
        having sum(clicks) > 0
        order by 2 desc nulls last
        limit 500
      `));
      return rows.map((r) => ({
        entity: String(r.entity),
        baselineClicks: Number(r.baseline_clicks ?? 0),
        currentClicks: Number(r.current_clicks ?? 0),
      }));
    },

    async loadPolicy() {
      const rows = rowsOf(await conn.execute(sql`select * from seo_guardian_policy where scope = 'GLOBAL' limit 1`));
      const row = rows[0];
      if (!row) return { killSwitches: { ...DEFAULT_KILL_SWITCHES }, autonomyByClass: {} };
      const killSwitches: KillSwitches = {
        organicAgentsEnabled: row.organic_agents_enabled !== false,
        autonomousWritesEnabled: row.autonomous_writes_enabled === true,
        externalWritesEnabled: row.external_writes_enabled === true,
        contentAutopublishEnabled: row.content_autopublish_enabled === true,
        emailNotificationsEnabled: row.email_notifications_enabled !== false,
        observeOnlyMode: row.observe_only_mode !== false,
      };
      return {
        killSwitches,
        changeBudget: row.change_budget && Object.keys(row.change_budget).length > 0 ? row.change_budget : undefined,
        materiality: row.materiality_thresholds && Object.keys(row.materiality_thresholds).length > 0 ? row.materiality_thresholds : undefined,
        autonomyByClass: row.autonomy_by_class ?? {},
      };
    },

    async loadSignal(key) {
      const rows = rowsOf(await conn.execute(sql`
        select id, state, consecutive_observations, alert_id
        from seo_guardian_signals where idempotency_key = ${key}
      `));
      const row = rows[0];
      return row
        ? {
            id: String(row.id),
            state: row.state,
            consecutiveObservations: Number(row.consecutive_observations ?? 0),
            alertId: row.alert_id ? String(row.alert_id) : null,
          }
        : null;
    },

    async saveSignal(i) {
      const rows = rowsOf(await conn.execute(sql`
        insert into seo_guardian_signals
          (idempotency_key, agent, entity, change_type, state, consecutive_observations,
           last_observed_at, last_absent_at, baseline_value, current_value,
           relative_change, absolute_change, materiality, commercially_important, updated_at)
        values
          (${i.key}, ${GUARDIAN_AGENT}, ${i.entity}, ${i.changeType}, ${i.state}, ${i.consecutiveObservations},
           now(), ${i.presentNow ? null : sql`now()`}, ${i.baselineValue}, ${i.currentValue},
           ${i.relativeChange}, ${i.absoluteChange}, ${i.materiality}, ${i.commerciallyImportant}, now())
        on conflict (idempotency_key) do update set
          state = excluded.state,
          consecutive_observations = excluded.consecutive_observations,
          last_observed_at = now(),
          last_absent_at = coalesce(excluded.last_absent_at, seo_guardian_signals.last_absent_at),
          baseline_value = excluded.baseline_value,
          current_value = excluded.current_value,
          relative_change = excluded.relative_change,
          absolute_change = excluded.absolute_change,
          materiality = excluded.materiality,
          confirmed_at = case when excluded.state = 'CONFIRMED' and seo_guardian_signals.confirmed_at is null
                              then now() else seo_guardian_signals.confirmed_at end,
          recovered_at = case when excluded.state = 'RECOVERED' then now() else seo_guardian_signals.recovered_at end,
          updated_at = now()
        returning id
      `));
      return { id: String(rows[0]?.id ?? '') };
    },

    async openOrUpdateIncident(i) {
      // Reuses the EXISTING seo_alerts table — no second incident system.
      //
      // seo_alerts' unique index on dedupe_key is PARTIAL (WHERE status =
      // 'OPEN'), so the conflict target must repeat that predicate or Postgres
      // rejects the statement. The semantics are also the ones we want: an
      // already-open alert is updated in place, while the same condition
      // recurring after a RESOLVED alert opens a fresh row — which is exactly
      // how the hysteresis model treats a relapse.
      const rows = rowsOf(await conn.execute(sql`
        insert into seo_alerts (severity, kind, message, dedupe_key, status)
        values (${i.severity}, ${i.kind}, ${i.message}, ${i.dedupeKey}, 'OPEN')
        on conflict (dedupe_key) where status = 'OPEN' do update set
          last_seen_at = now(),
          message = excluded.message
        returning id, (xmax = 0) as inserted
      `));
      return { id: String(rows[0]?.id ?? ''), created: rows[0]?.inserted === true };
    },

    async linkSignalToIncident({ signalId, alertId }) {
      await conn.execute(sql`
        update seo_guardian_signals set alert_id = ${alertId}::uuid, updated_at = now()
        where id = ${signalId}::uuid and alert_id is distinct from ${alertId}::uuid
      `);
    },

    async resolveIncident(dedupeKey) {
      await conn.execute(sql`
        update seo_alerts set status = 'RESOLVED', resolved_at = now()
        where dedupe_key = ${dedupeKey} and status <> 'RESOLVED'
      `);
    },

    async recordAction(a) {
      await conn.execute(sql`
        insert into seo_guardian_actions
          (run_id, signal_id, idempotency_key, remediation_class, tier, mode, decision, decision_reason, entity, proposed_urls)
        values
          (${a.runId}::uuid, ${a.signalId ? sql`${a.signalId}::uuid` : null}, ${a.key}, ${a.remediationClass},
           ${a.tier}, ${a.mode}, ${a.decision}, ${a.decisionReason}, ${a.entity}, ${a.proposedUrls})
        on conflict (idempotency_key) do update set
          decision = excluded.decision,
          decision_reason = excluded.decision_reason,
          mode = excluded.mode
      `);
    },

    async startRun(agent) {
      // Distributed lease. A lost lock means another replica holds the run.
      const got = rowsOf(await conn.execute(sql`select pg_try_advisory_lock(${GUARDIAN_LOCK_ID}) as ok`));
      if (got[0]?.ok !== true) return null;
      lockHeld = true;

      // Recover a crashed predecessor rather than blocking forever.
      await conn.execute(sql`
        update seo_guardian_runs
        set status = 'FAILED', finished_at = now(), error = 'Abandoned: no heartbeat within the stale window.'
        where agent = ${agent} and status = 'RUNNING'
          and started_at < now() - (${STALE_RUN_MINUTES} * interval '1 minute')
      `);

      const rows = rowsOf(await conn.execute(sql`
        insert into seo_guardian_runs (agent, status, policy_version)
        values (${agent}, 'RUNNING', ${GUARDIAN_POLICY_VERSION})
        returning id
      `));
      return { runId: String(rows[0]?.id ?? '') };
    },

    async finishRun(f) {
      await conn.execute(sql`
        update seo_guardian_runs set
          status = ${f.status}, finished_at = now(),
          freshness = ${f.freshness.state}, freshness_lag_days = ${f.freshness.lagDays},
          comparison_valid = ${f.freshness.comparisonValid}, latest_source_date = ${f.latestSourceDate}::date,
          signals_evaluated = ${f.signalsEvaluated}, material_changes = ${f.materialChanges},
          incidents_opened = ${f.incidentsOpened}, actions_attempted = ${f.actionsAttempted},
          actions_failed = ${f.actionsFailed}, circuit_state = ${f.circuitState},
          circuit_reasons = ${JSON.stringify(f.circuitReasons)}::text::jsonb,
          notification_sent = ${f.notificationSent},
          notification_events = ${JSON.stringify(f.notificationEvents)}::text::jsonb,
          error = ${f.error ?? null}
        where id = ${f.runId}::uuid
      `);
    },

    async providerHealth() {
      const rows = rowsOf(await conn.execute(sql`
        select status, last_error from seo_integration_connections
        where provider_id = ${GSC_PROVIDER_ID} order by created_at desc limit 1
      `));
      const status = String(rows[0]?.status ?? '');
      return {
        abnormal: ['ERROR', 'PROVIDER_ERROR', 'RATE_LIMITED'].includes(status),
        authChanged: ['AUTH_EXPIRED', 'AUTHORIZATION_REQUIRED', 'PERMISSION_ERROR'].includes(status),
      };
    },

    async indexableInventory() {
      const rows = rowsOf(await conn.execute(sql`
        select count(*)::int as n from products where active = true and approval_status = 'approved'
      `));
      return Number(rows[0]?.n ?? 0);
    },

    async recentFalsePositiveRate() {
      // Not fabricated: a rate only exists once outcomes have been labelled.
      return null;
    },

    async sendAggregatedNotification(input) {
      // Email is deliberately out of scope for this tranche. The run record and
      // the audit ledger ARE the notification channel; the Control Center reads
      // them. Nothing is silently dropped and nothing pretends to have been sent.
      logger.info(
        { runId: input.runId, events: input.events, agent: GUARDIAN_AGENT },
        `[SearchConsoleGuardian] ${input.summary}`,
      );
      return { delivered: false, detail: 'CONTROL_CENTER_AND_AUDIT_ONLY' };
    },
  };

  try {
    const uc = new SearchConsoleGuardianUseCase(ports);
    const r = await uc.execute();
    return {
      ran: r.ran, runId: r.runId, providerReadiness: r.providerReadiness, phase: r.phase,
      materialChanges: r.materialChanges, incidentsOpened: r.incidentsOpened, summary: r.summary,
    };
  } catch (err: any) {
    // Provider failure isolation: the Guardian must never break the shared
    // analytics fan-out queue.
    logger.error({ err: String(err?.message ?? err) }, '[SearchConsoleGuardian] run threw');
    return {
      ran: false, runId: null, providerReadiness: 'UNKNOWN', phase: null,
      materialChanges: 0, incidentsOpened: 0, summary: 'Guardian run threw and was contained.',
    };
  } finally {
    if (lockHeld) {
      await conn.execute(sql`select pg_advisory_unlock(${GUARDIAN_LOCK_ID})`).catch(() => undefined);
    }
  }
}
