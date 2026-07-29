import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import type {
  ApprovalProbe,
  DependencyProbe,
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
        const rows = (result as unknown as { rows?: { relation: string | null }[] }).rows ?? [];
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
      const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
      return rows.length > 0;
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
    };
    const keys = envKeys[provider] ?? [];
    return keys.length > 0 && keys.some((key) => Boolean(process.env[key]));
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
  const rows = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
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
