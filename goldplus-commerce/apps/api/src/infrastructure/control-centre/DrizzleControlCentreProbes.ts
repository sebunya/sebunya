import { sql } from 'drizzle-orm';

/**
 * postgres-js returns the row ARRAY from db.execute() directly; node-postgres
 * shapes it as {rows}. Reading only `.rows` here made EVERY table probe report
 * DOWN ("dependency postgres.X did not respond"), every approval read as
 * absent (all programmes DORMANT), and the approvals ledger render empty —
 * one driver-shape bug, three symptoms across the whole Trust Centre.
 */
const rowsOf = (r: unknown): Record<string, unknown>[] =>
  Array.isArray(r) ? (r as Record<string, unknown>[]) : ((r as { rows?: Record<string, unknown>[] })?.rows ?? []);
import { db } from '../db/client';
import { logger } from '../logging/logger';
import { EVENT_TYPE_TELEMETRY } from '../telemetry/TelemetryDispatchService';
import type {
  ApprovalProbe,
  DependencyProbe,
  HealthProbe,
  ProviderConfigProbe,
  RouteMountProbe,
} from '../../application/use-cases/control-centre/EvaluateModuleReadinessUseCase';
import type {
  IModuleApprovalRepository,
  ModuleApprovalRecord,
} from '../../application/use-cases/control-centre/ModuleActivationApprovalUseCases';

/**
 * Infrastructure adapters for Control Centre readiness.
 *
 * These live here rather than in the route so the HTTP layer stays thin and free
 * of Drizzle, per the clean-architecture boundary the domain-purity test enforces.
 * The use case depends only on the port interfaces.
 */

export const drizzleDependencyProbe: DependencyProbe = {
  async isUp(name: string, table?: string): Promise<boolean> {
    if (name !== 'postgres') return false;
    try {
      if (table) {
        // to_regclass returns NULL rather than throwing for an absent relation, so a
        // missing table is a clean false instead of a caught exception.
        const result = await db.execute(sql`select to_regclass(${`public.${table}`}) as relation`);
        const rows = rowsOf(result);
        return Boolean(rows[0]?.relation);
      }
      await db.execute(sql`select 1`);
      return true;
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), dependency: name, table },
        '[ControlCentre] dependency probe failed',
      );
      return false;
    }
  },
};

/**
 * Activation approvals are governed records, not environment flags, so a module
 * cannot be switched on by a deploy-time variable. An absent approval store means
 * nothing is approved — the safe reading is DORMANT, never ACTIVE.
 */
export const drizzleApprovalProbe: ApprovalProbe = {
  async isApproved(moduleKey: string): Promise<boolean> {
    try {
      const result = await db.execute(
        sql`select 1 from module_activation_approvals
            where module_key = ${moduleKey} and revoked_at is null limit 1`,
      );
      return rowsOf(result).length > 0;
    } catch {
      return false;
    }
  },
};

/** Presence only — credential values are never read into a readiness payload. */
export const envProviderConfigProbe: ProviderConfigProbe = {
  isConfigured(provider: string): boolean {
    const envKeys: Record<string, string[]> = {
      meta: ['META_CAPI_ACCESS_TOKEN'],
      google: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_OAUTH_CLIENT_ID'],
      tiktok: ['TIKTOK_EVENTS_ACCESS_TOKEN'],
      whatsapp: ['WHATSAPP_ACCESS_TOKEN'],
      // Customer and admin messaging. Absent from this map, an unknown provider
      // fell through to "not configured" by accident rather than by
      // measurement, and notifications had no module asking the question at all.
      email: ['ZEPTOMAIL_API_TOKEN'],
      sms: ['SMS_API_KEY'],
    };
    const keys = envKeys[provider] ?? [];
    return keys.length > 0 && keys.some((key) => Boolean(process.env[key]));
  },
};

/**
 * Outcome checks: is the capability achieving anything?
 *
 * `notification_delivery` reads the outbox's own verdict. A dead letter is a
 * message the system tried up to exhaustion and gave up on, so recent dead
 * letters mean messages are not arriving however healthy the credentials look.
 * Notifications reported LIVE for three weeks while every admin order email
 * died at the provider; this is what makes that visible in the console.
 */
const DELIVERY_WINDOW_DAYS = 7;

export const drizzleHealthProbe: HealthProbe = {
  async check(name: string): Promise<{ healthy: boolean; detail?: string }> {
    if (name !== 'notification_delivery') {
      // An unknown check must not silently pass as healthy.
      return { healthy: false, detail: `unknown health check "${name}"` };
    }
    const rows = rowsOf(await db.execute(sql`
      select count(*)::int as dead, max(created_at) as newest
      from outbox_events
      where status in ('dead_letter', 'dead_lettered')
        -- Telemetry shares this table but has its own dispatcher, its own
        -- backoff and its own dead-letter meaning. Counting it here would blame
        -- messaging for an analytics fault: harmless while email is also
        -- failing, and a false alarm the moment it is fixed.
        and event_type <> ${EVENT_TYPE_TELEMETRY}
        -- make_interval takes a typed int. Concatenating a bare parameter onto
        -- a string before an interval cast leaves Postgres unable to infer that
        -- parameter's type, and the whole query fails.
        and created_at > now() - make_interval(days => ${DELIVERY_WINDOW_DAYS})
    `));
    const dead = Number(rows[0]?.dead ?? 0);
    if (dead === 0) return { healthy: true };
    return {
      healthy: false,
      detail: `${dead} message${dead === 1 ? '' : 's'} dead-lettered in the last ${DELIVERY_WINDOW_DAYS} days; see /admin/notifications`,
    };
  },
};

/**
 * Route mounts are read from the running app's prefix list rather than a
 * hand-maintained copy, so a module whose router is deleted or never mounted
 * reports UNAVAILABLE instead of silently claiming LIVE.
 */
export function createRouteMountProbe(mountedPrefixes: readonly string[]): RouteMountProbe {
  const prefixes = new Set(mountedPrefixes);
  return {
    isMounted(apiMount: string): boolean {
      if (prefixes.has(apiMount)) return true;
      // A nested mount such as /admin/measurement/gtm satisfies /admin/measurement.
      for (const prefix of prefixes) {
        if (prefix.startsWith(`${apiMount}/`)) return true;
      }
      return false;
    },
  };
}

/**
 * Approval ledger adapter over module_activation_approvals (migration 0049).
 *
 * The database enforces the invariants — one live approval per module via a
 * partial unique index, non-blank reason and reference, complete revocations —
 * so this adapter stays a thin mapping and cannot weaken them.
 */
export const drizzleModuleApprovalRepository: IModuleApprovalRepository = {
  async list() {
    const result = await db.execute(sql`
      select id, module_key, approved_by, approved_at, reason, approval_reference,
             revoked_by, revoked_at, revocation_reason, trace_id
      from module_activation_approvals
      order by approved_at desc
    `);
    return toRecords(result);
  },

  async findLive(moduleKey) {
    const result = await db.execute(sql`
      select id, module_key, approved_by, approved_at, reason, approval_reference,
             revoked_by, revoked_at, revocation_reason, trace_id
      from module_activation_approvals
      where module_key = ${moduleKey} and revoked_at is null
      limit 1
    `);
    return toRecords(result)[0] ?? null;
  },

  async approve(input) {
    const result = await db.execute(sql`
      insert into module_activation_approvals
        (module_key, approved_by, reason, approval_reference, trace_id)
      values (${input.moduleKey}, ${input.approvedBy}, ${input.reason},
              ${input.approvalReference}, ${input.traceId})
      returning id, module_key, approved_by, approved_at, reason, approval_reference,
                revoked_by, revoked_at, revocation_reason, trace_id
    `);
    return toRecords(result)[0];
  },

  async revoke(input) {
    const result = await db.execute(sql`
      update module_activation_approvals
      set revoked_by = ${input.revokedBy},
          revoked_at = now(),
          revocation_reason = ${input.revocationReason}
      where module_key = ${input.moduleKey} and revoked_at is null
      returning id, module_key, approved_by, approved_at, reason, approval_reference,
                revoked_by, revoked_at, revocation_reason, trace_id
    `);
    return toRecords(result)[0] ?? null;
  },
};

function toRecords(result: unknown): ModuleApprovalRecord[] {
  const rows = rowsOf(result);
  return rows.map((row) => ({
    id: String(row.id),
    moduleKey: String(row.module_key),
    approvedBy: String(row.approved_by),
    approvedAt: new Date(row.approved_at as string).toISOString(),
    reason: String(row.reason),
    approvalReference: String(row.approval_reference),
    revokedBy: row.revoked_by ? String(row.revoked_by) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string).toISOString() : null,
    revocationReason: row.revocation_reason ? String(row.revocation_reason) : null,
    traceId: row.trace_id ? String(row.trace_id) : null,
  }));
}
