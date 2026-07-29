import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import type {
  ApprovalProbe,
  DependencyProbe,
  ProviderConfigProbe,
  RouteMountProbe,
} from '../../application/use-cases/control-centre/EvaluateModuleReadinessUseCase';

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
