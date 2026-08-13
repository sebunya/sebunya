import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { SeoProviderManifest } from '../../../application/use-cases/seo-growth/RegisterSeoIntegrationProvidersUseCase';
import { pgJsonb } from '../PgParams';

/**
 * SEO Integrations Control Plane data access (migration 0118). Raw-SQL via
 * db.execute with the rowsOf guard, matching DrizzleSeoGrowthRepository.
 * jsonb binding rules: objects bind `${pgJsonb(obj)}`, arrays bind
 * `${JSON.stringify(arr)}::text::jsonb`.
 *
 * Secret discipline: ciphertext leaves this repository ONLY via
 * getActiveCredential (for adapters/vault decryption). Every listing method
 * excludes the ciphertext column at the SQL level.
 */

const rowsOf = (result: unknown): any[] => (Array.isArray(result) ? result : (result as any)?.rows ?? []);

export interface SeoConnectionInput {
  providerId: string;
  name: string;
  config?: Record<string, unknown>;
  enabledCapabilities?: string[];
  syncFrequency?: string | null;
  backfillWindowDays?: number | null;
  accountRef?: string | null;
  propertyRef?: string | null;
  createdBy?: string | null;
}

export class DrizzleSeoIntegrationRepository {
  // ── Providers ─────────────────────────────────────────────────────────────

  async upsertProvider(m: SeoProviderManifest): Promise<any> {
    const manifest = {
      configurationSchema: m.configurationSchema,
      credentialSchema: m.credentialSchema,
      quota: m.quota,
      backfillWindowMonths: m.backfillWindowMonths ?? null,
      oauthScopes: m.oauthScopes ?? [],
      notes: m.notes ?? null,
    };
    const rows = rowsOf(await db.execute(sql`
      insert into seo_integration_providers
        (provider_id, canonical_name, family, description, auth_types, capabilities, supports,
         default_sync_frequency, docs_url, enabled, experimental, adapter_version, manifest)
      values
        (${m.providerId}, ${m.canonicalName}, ${m.family}, ${m.description},
         ${JSON.stringify(m.authTypes)}::text::jsonb, ${JSON.stringify(m.capabilities)}::text::jsonb,
         ${pgJsonb(m.supports)}, ${m.defaultSyncFrequency}, ${m.docsUrl},
         ${m.enabled}, ${m.experimental}, ${m.adapterVersion}, ${pgJsonb(manifest)})
      on conflict (provider_id) do update set
        canonical_name = excluded.canonical_name,
        family = excluded.family,
        description = excluded.description,
        auth_types = excluded.auth_types,
        capabilities = excluded.capabilities,
        supports = excluded.supports,
        default_sync_frequency = excluded.default_sync_frequency,
        docs_url = excluded.docs_url,
        experimental = excluded.experimental,
        adapter_version = excluded.adapter_version,
        manifest = excluded.manifest,
        updated_at = now()
      returning *
    `));
    return rows[0] ?? null;
  }

  async listProviders(): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select * from seo_integration_providers order by canonical_name asc
    `));
  }

  async getProvider(providerId: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`
      select * from seo_integration_providers where provider_id = ${providerId} limit 1
    `));
    return rows[0] ?? null;
  }

  // ── Connections ───────────────────────────────────────────────────────────

  async createConnection(input: SeoConnectionInput): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_integration_connections
        (provider_id, name, config, enabled_capabilities, sync_frequency, backfill_window_days,
         account_ref, property_ref, created_by, status)
      values
        (${input.providerId}, ${input.name}, ${(input.config ?? {}) as never}::jsonb,
         ${JSON.stringify(input.enabledCapabilities ?? [])}::text::jsonb,
         ${input.syncFrequency ?? null}, ${input.backfillWindowDays ?? null},
         ${input.accountRef ?? null}, ${input.propertyRef ?? null}, ${input.createdBy ?? null},
         'NOT_CONFIGURED')
      returning *
    `));
    return rows[0] ?? null;
  }

  async updateConnection(id: string, patch: Partial<SeoConnectionInput> & { status?: string }): Promise<any | null> {
    const existing = await this.getConnection(id);
    if (!existing) return null;
    const rows = rowsOf(await db.execute(sql`
      update seo_integration_connections set
        name = ${patch.name ?? existing.name},
        config = ${((patch.config ?? existing.config ?? {}) as never)}::jsonb,
        enabled_capabilities = ${JSON.stringify(patch.enabledCapabilities ?? existing.enabled_capabilities ?? [])}::text::jsonb,
        sync_frequency = ${patch.syncFrequency !== undefined ? patch.syncFrequency : existing.sync_frequency},
        backfill_window_days = ${patch.backfillWindowDays !== undefined ? patch.backfillWindowDays : existing.backfill_window_days},
        account_ref = ${patch.accountRef !== undefined ? patch.accountRef : existing.account_ref},
        property_ref = ${patch.propertyRef !== undefined ? patch.propertyRef : existing.property_ref},
        status = ${patch.status ?? existing.status},
        updated_at = now()
      where id = ${id}
      returning *
    `));
    return rows[0] ?? null;
  }

  async setConnectionStatus(id: string, patch: {
    status?: string;
    lastSuccessAt?: Date | null;
    lastAttemptAt?: Date | null;
    lastError?: string | null;
    dataFreshnessAt?: Date | null;
    quotaState?: Record<string, unknown> | null;
  }): Promise<any | null> {
    const existing = await this.getConnection(id);
    if (!existing) return null;
    const rows = rowsOf(await db.execute(sql`
      update seo_integration_connections set
        status = ${patch.status ?? existing.status},
        last_success_at = ${patch.lastSuccessAt !== undefined ? patch.lastSuccessAt : existing.last_success_at},
        last_attempt_at = ${patch.lastAttemptAt !== undefined ? patch.lastAttemptAt : existing.last_attempt_at},
        last_error = ${patch.lastError !== undefined ? patch.lastError : existing.last_error},
        data_freshness_at = ${patch.dataFreshnessAt !== undefined ? patch.dataFreshnessAt : existing.data_freshness_at},
        quota_state = ${pgJsonb(patch.quotaState !== undefined ? (patch.quotaState as never) : (existing.quota_state as never))},
        updated_at = now()
      where id = ${id}
      returning *
    `));
    return rows[0] ?? null;
  }

  async listConnections(providerId?: string): Promise<any[]> {
    if (providerId) {
      return rowsOf(await db.execute(sql`
        select * from seo_integration_connections where provider_id = ${providerId} order by created_at asc
      `));
    }
    return rowsOf(await db.execute(sql`
      select * from seo_integration_connections order by created_at asc
    `));
  }

  async getConnection(id: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`
      select * from seo_integration_connections where id = ${id} limit 1
    `));
    return rows[0] ?? null;
  }

  async deleteConnection(id: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      delete from seo_integration_connections where id = ${id} returning id
    `));
    return rows.length > 0;
  }

  // ── Credentials (ciphertext never leaves except getActiveCredential) ──────

  async addCredential(input: {
    connectionId: string;
    authType: string;
    ciphertext: string;
    mask: string;
    createdBy?: string | null;
    expiresAt?: Date | null;
  }): Promise<any> {
    const prev = rowsOf(await db.execute(sql`
      update seo_integration_credentials
      set status = 'ROTATED', last_rotated_at = now(), updated_at = now()
      where connection_id = ${input.connectionId} and status = 'ACTIVE'
      returning version
    `));
    const version = prev.length > 0 ? Math.max(...prev.map((r) => Number(r.version) || 1)) + 1 : 1;
    const rows = rowsOf(await db.execute(sql`
      insert into seo_integration_credentials
        (connection_id, auth_type, ciphertext, mask, version, status, created_by, expires_at)
      values
        (${input.connectionId}, ${input.authType}, ${input.ciphertext}, ${input.mask},
         ${version}, 'ACTIVE', ${input.createdBy ?? null}, ${input.expiresAt ?? null})
      returning id, connection_id, auth_type, mask, version, status, expires_at, created_at
    `));
    return rows[0] ?? null;
  }

  /** INTERNAL: the only accessor that returns ciphertext (for vault decryption). */
  async getActiveCredential(connectionId: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`
      select * from seo_integration_credentials
      where connection_id = ${connectionId} and status = 'ACTIVE'
      order by version desc limit 1
    `));
    return rows[0] ?? null;
  }

  async listCredentials(connectionId: string): Promise<any[]> {
    // Ciphertext deliberately excluded at the SQL level.
    return rowsOf(await db.execute(sql`
      select id, connection_id, auth_type, mask, version, status, expires_at,
             last_rotated_at, created_at, updated_at
      from seo_integration_credentials
      where connection_id = ${connectionId}
      order by version desc
    `));
  }

  async revokeCredential(id: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      update seo_integration_credentials set status = 'REVOKED', updated_at = now()
      where id = ${id} and status in ('ACTIVE','ROTATED')
      returning id
    `));
    return rows.length > 0;
  }

  /** Provider ids that have at least one connection holding an ACTIVE credential. */
  async listVaultConfiguredProviders(): Promise<string[]> {
    const rows = rowsOf(await db.execute(sql`
      select distinct c.provider_id
      from seo_integration_connections c
      join seo_integration_credentials cr on cr.connection_id = c.id and cr.status = 'ACTIVE'
      where c.status <> 'DISABLED'
    `));
    return rows.map((r) => String(r.provider_id));
  }

  /** First non-disabled connection for a provider that has an ACTIVE credential. */
  async findConnectionWithActiveCredential(providerId: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`
      select c.* from seo_integration_connections c
      join seo_integration_credentials cr on cr.connection_id = c.id and cr.status = 'ACTIVE'
      where c.provider_id = ${providerId} and c.status <> 'DISABLED'
      order by c.created_at asc limit 1
    `));
    return rows[0] ?? null;
  }

  // ── Sync jobs ─────────────────────────────────────────────────────────────

  async createSyncJob(input: { connectionId: string; jobType: string; requestedBy?: string | null }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_integration_sync_jobs (connection_id, job_type, requested_by)
      values (${input.connectionId}, ${input.jobType}, ${input.requestedBy ?? null})
      returning *
    `));
    return rows[0] ?? null;
  }

  async updateSyncJob(id: string, patch: {
    status?: string;
    startedAt?: Date | null;
    completedAt?: Date | null;
    recordsRead?: number;
    recordsInserted?: number;
    recordsUpdated?: number;
    recordsRejected?: number;
    cursor?: Record<string, unknown> | null;
    error?: string | null;
  }): Promise<any | null> {
    const existingRows = rowsOf(await db.execute(sql`
      select * from seo_integration_sync_jobs where id = ${id} limit 1
    `));
    const existing = existingRows[0];
    if (!existing) return null;
    const rows = rowsOf(await db.execute(sql`
      update seo_integration_sync_jobs set
        status = ${patch.status ?? existing.status},
        started_at = ${patch.startedAt !== undefined ? patch.startedAt : existing.started_at},
        completed_at = ${patch.completedAt !== undefined ? patch.completedAt : existing.completed_at},
        records_read = ${patch.recordsRead ?? existing.records_read},
        records_inserted = ${patch.recordsInserted ?? existing.records_inserted},
        records_updated = ${patch.recordsUpdated ?? existing.records_updated},
        records_rejected = ${patch.recordsRejected ?? existing.records_rejected},
        cursor = ${pgJsonb(patch.cursor !== undefined ? (patch.cursor as never) : (existing.cursor as never))},
        error = ${patch.error !== undefined ? patch.error : existing.error}
      where id = ${id}
      returning *
    `));
    return rows[0] ?? null;
  }

  async cancelSyncJob(id: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      update seo_integration_sync_jobs
      set status = 'CANCELLED', completed_at = now()
      where id = ${id} and status in ('QUEUED','RUNNING')
      returning id
    `));
    return rows.length > 0;
  }

  async listSyncJobs(opts: { connectionId?: string; status?: string; limit?: number } = {}): Promise<any[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const conds = [sql`true`];
    if (opts.connectionId) conds.push(sql`connection_id = ${opts.connectionId}`);
    if (opts.status) conds.push(sql`status = ${opts.status}`);
    return rowsOf(await db.execute(sql`
      select * from seo_integration_sync_jobs
      where ${sql.join(conds, sql` and `)}
      order by requested_at desc limit ${limit}
    `));
  }

  // ── Integration audit ─────────────────────────────────────────────────────

  async appendAudit(input: {
    connectionId?: string | null;
    providerId?: string | null;
    actorId?: string | null;
    action: string;
    detail?: Record<string, unknown>;
  }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_integration_audit (connection_id, provider_id, actor_id, action, detail)
      values (${input.connectionId ?? null}, ${input.providerId ?? null}, ${input.actorId ?? null},
              ${input.action}, ${(input.detail ?? {}) as never}::jsonb)
      returning *
    `));
    return rows[0] ?? null;
  }

  async listAudit(opts: { connectionId?: string; limit?: number } = {}): Promise<any[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    if (opts.connectionId) {
      return rowsOf(await db.execute(sql`
        select * from seo_integration_audit where connection_id = ${opts.connectionId}
        order by occurred_at desc limit ${limit}
      `));
    }
    return rowsOf(await db.execute(sql`
      select * from seo_integration_audit order by occurred_at desc limit ${limit}
    `));
  }

  // ── Usage / quota ─────────────────────────────────────────────────────────

  /**
   * Atomically increment today's counter for a provider, refusing beyond the
   * cap. Returns { allowed, count }; when allowed=false nothing was consumed.
   */
  async tryConsumeUsage(providerId: string, cap: number | null): Promise<{ allowed: boolean; count: number }> {
    const upsert = rowsOf(await db.execute(sql`
      insert into seo_integration_usage (provider_id, day, request_count)
      values (${providerId}, current_date, 1)
      on conflict (provider_id, day) do update
        set request_count = seo_integration_usage.request_count + 1
        where ${cap === null} or seo_integration_usage.request_count < ${cap ?? 0}
      returning request_count
    `));
    if (upsert.length > 0) return { allowed: true, count: Number(upsert[0].request_count) };
    const current = rowsOf(await db.execute(sql`
      select request_count from seo_integration_usage
      where provider_id = ${providerId} and day = current_date
    `));
    return { allowed: false, count: Number(current[0]?.request_count ?? 0) };
  }

  async listUsage(providerId?: string, days = 30): Promise<any[]> {
    const window = Math.min(Math.max(days, 1), 365);
    if (providerId) {
      return rowsOf(await db.execute(sql`
        select provider_id, day, request_count from seo_integration_usage
        where provider_id = ${providerId} and day >= current_date - ${window}::int
        order by day desc
      `));
    }
    return rowsOf(await db.execute(sql`
      select provider_id, day, request_count from seo_integration_usage
      where day >= current_date - ${window}::int
      order by day desc, provider_id asc
    `));
  }
}
