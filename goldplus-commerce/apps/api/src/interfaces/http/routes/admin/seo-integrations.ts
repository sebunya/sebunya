import { Hono, Context } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { QueueService, QUEUES } from '../../../../infrastructure/queues/QueueService';
import { logger } from '../../../../infrastructure/logging/logger';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { RegisterSeoIntegrationProvidersUseCase } from '../../../../application/use-cases/seo-growth/RegisterSeoIntegrationProvidersUseCase';
import type { SeoIntegrationConnectionView, SeoIntegrationTestResult } from '../../../../application/ports/SeoIntegrationAdapter';
import { dailyCapOf, freshnessOf, statusAfterCredentialAdd, statusForTest } from '../../../../application/use-cases/seo-growth/SeoIntegrationLifecycle';

/**
 * SEO Integrations Control Plane — admin API (mounted at /admin/seo/integrations).
 *
 * Thin Hono routes over DrizzleSeoIntegrationRepository, the credential vault,
 * the Google OAuth framework and the provider adapters.
 *
 * Permission map:
 *   seo.view                          — every GET
 *   seo.integrations.connect          — connection CRUD + resource selection
 *   seo.integrations.credentials      — credential add / rotate / revoke / list
 *   seo.integrations.manage           — test-connection, discovery, sync, OAuth
 *   seo.integrations.custom_connector — anything touching custom-readonly-rest
 *
 * Secret discipline: credentials are encrypted at the boundary; ciphertext and
 * plaintext never appear in any response, log line or audit row — only masks.
 * Status honesty: READY only after a passing staged test; CONNECTED/HEALTHY
 * only after a successful data operation.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = (c: Context, data: unknown, status = 200) =>
  c.json({ success: true, data } as ApiResponse<unknown>, status as never);
const bad = (c: Context, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } } as ApiResponse<never>, status as never);
const json = async (c: Context): Promise<any | null> => c.req.json().catch(() => null);
const actorId = (c: Context): string => (c.get('user') as any).id as string;

const repo = () => Registry.getInstance().seoIntegrationRepo;

/** Platform audit trail + integration audit — metadata only, never secrets. */
const audit = async (
  c: Context,
  action: string,
  ref: { connectionId?: string | null; providerId?: string | null },
  detail?: Record<string, unknown>,
) => {
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: actorId(c),
    action,
    entity: 'seo_integration',
    entityId: String(ref.connectionId ?? ref.providerId ?? ''),
    newState: detail ?? null,
  });
  await repo().appendAudit({ ...ref, actorId: actorId(c), action, detail: detail ?? {} });
};

const CUSTOM_PROVIDER = 'custom-readonly-rest';

/** custom-readonly-rest operations need the dedicated custom-connector right on top. */
const requireCustomConnectorRight = (c: Context, providerId: string): boolean => {
  if (providerId !== CUSTOM_PROVIDER) return true;
  const user = c.get('user') as { permissions: string[] } | undefined;
  return Boolean(user?.permissions?.includes(PERMISSIONS.SEO_INTEGRATIONS_CUSTOM_CONNECTOR));
};

const asConnectionView = (row: any): SeoIntegrationConnectionView => ({
  id: row.id,
  providerId: row.provider_id,
  name: row.name,
  status: row.status,
  accountRef: row.account_ref ?? null,
  propertyRef: row.property_ref ?? null,
  config: (row.config ?? {}) as Record<string, unknown>,
});

const rowFreshness = (row: any): 'FRESH' | 'STALE' | 'NO_DATA' =>
  freshnessOf(row.last_success_at ?? null, row.sync_frequency ?? null);

const capFor = (provider: any, connection: any): number | null =>
  dailyCapOf(provider?.manifest ?? null, connection?.config ?? null);

const vault = async () => {
  const { IntegrationCredentialVault } = await import('../../../../infrastructure/seo/IntegrationCredentialVault');
  return IntegrationCredentialVault.fromEnv();
};

const decryptActiveSecret = async (connectionId: string): Promise<Record<string, unknown> | null> => {
  const credential = await repo().getActiveCredential(connectionId);
  if (!credential) return null;
  const v = await vault();
  if (!v) return null;
  try {
    return v.decrypt<Record<string, unknown>>(credential.ciphertext);
  } catch {
    return null;
  }
};

// ── Providers ───────────────────────────────────────────────────────────────

/**
 * Shapes one provider row into the admin view contract.
 *
 * `supports`, `capabilities` and `manifest` are SEPARATE top-level fields, and
 * saying so explicitly is the point. Returning the raw row let the admin pages
 * read `manifest.supports.manualSync`, which is always undefined — `supports`
 * is its own column, and `manifest` holds only schemas, quota and notes. The
 * Run sync button therefore stayed hidden on a connection whose backend fully
 * supported it, and nothing failed loudly enough to notice.
 */
export function toProviderAdminView(row: any) {
  return {
    provider_id: String(row.provider_id),
    canonical_name: String(row.canonical_name),
    family: String(row.family),
    description: String(row.description ?? ''),
    auth_types: row.auth_types ?? [],
    capabilities: row.capabilities ?? [],
    // Operational capability flags — what an operator may DO with this provider.
    supports: row.supports ?? {},
    default_sync_frequency: row.default_sync_frequency ?? null,
    docs_url: row.docs_url ?? null,
    enabled: Boolean(row.enabled),
    experimental: Boolean(row.experimental),
    adapter_version: String(row.adapter_version ?? '1'),
    // Declarative descriptors only: configuration/credential schemas, quota,
    // oauth scopes, notes. Never operational flags.
    manifest: row.manifest ?? {},
  };
}

routes.get('/providers', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  // Idempotent bootstrap: the manifest registry is code-authoritative.
  await new RegisterSeoIntegrationProvidersUseCase(repo()).execute();
  const providers = await repo().listProviders();
  return ok(c, providers.map(toProviderAdminView));
});

routes.post('/providers/register', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_MANAGE]), async (c) => {
  const result = await new RegisterSeoIntegrationProvidersUseCase(repo()).execute();
  await audit(c, 'SEO_INTEGRATION_PROVIDERS_REGISTERED', {}, { registered: result.registered });
  return ok(c, result);
});

// ── Connections ─────────────────────────────────────────────────────────────

routes.get('/connections', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const rows = await repo().listConnections(c.req.query('providerId') || undefined);
  return ok(c, rows.map((r: any) => ({ ...r, freshness: rowFreshness(r) })));
});

routes.post('/connections', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_CONNECT]), async (c) => {
  const body = await json(c);
  if (!body || typeof body.providerId !== 'string' || typeof body.name !== 'string' || body.name.trim() === '') {
    return bad(c, 'BAD_INPUT', 'providerId and name are required.');
  }
  const provider = await repo().getProvider(body.providerId);
  if (!provider) return bad(c, 'NOT_FOUND', 'Unknown provider.', 404);
  if (!provider.enabled) return bad(c, 'PROVIDER_DISABLED', 'Provider is disabled.', 409);
  if (!requireCustomConnectorRight(c, body.providerId)) {
    return bad(c, 'FORBIDDEN', 'The custom read-only connector requires seo.integrations.custom_connector.', 403);
  }
  const supports = (provider.supports ?? {}) as { multipleConnections?: boolean };
  if (!supports.multipleConnections) {
    const existing = await repo().listConnections(body.providerId);
    if (existing.length > 0) return bad(c, 'ALREADY_EXISTS', 'This provider supports a single connection.', 409);
  }
  const row = await repo().createConnection({
    providerId: body.providerId,
    name: body.name.trim(),
    config: body.config && typeof body.config === 'object' ? body.config : {},
    enabledCapabilities: Array.isArray(body.enabledCapabilities) ? body.enabledCapabilities : [],
    syncFrequency: typeof body.syncFrequency === 'string' ? body.syncFrequency : provider.default_sync_frequency,
    backfillWindowDays: Number.isFinite(Number(body.backfillWindowDays)) ? Number(body.backfillWindowDays) : null,
    createdBy: actorId(c),
  });
  await audit(c, 'SEO_INTEGRATION_CONNECTION_CREATED', { connectionId: row.id, providerId: body.providerId }, { name: row.name });
  return ok(c, row, 201);
});

routes.patch('/connections/:id', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_CONNECT]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const existing = await repo().getConnection(c.req.param('id') ?? '');
  if (!existing) return bad(c, 'NOT_FOUND', 'Connection not found.', 404);
  if (!requireCustomConnectorRight(c, existing.provider_id)) {
    return bad(c, 'FORBIDDEN', 'The custom read-only connector requires seo.integrations.custom_connector.', 403);
  }
  if (body.status !== undefined && body.status !== 'DISABLED' && !(body.status === 'NOT_CONFIGURED' && existing.status === 'DISABLED')) {
    // Statuses are earned by tests/syncs, never hand-set — except disabling and re-enabling.
    return bad(c, 'BAD_INPUT', 'status can only be set to DISABLED (or back to NOT_CONFIGURED from DISABLED).');
  }
  const row = await repo().updateConnection(existing.id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    config: body.config && typeof body.config === 'object' ? body.config : undefined,
    enabledCapabilities: Array.isArray(body.enabledCapabilities) ? body.enabledCapabilities : undefined,
    syncFrequency: body.syncFrequency !== undefined ? body.syncFrequency : undefined,
    backfillWindowDays: body.backfillWindowDays !== undefined ? Number(body.backfillWindowDays) : undefined,
    status: body.status,
  });
  await audit(c, 'SEO_INTEGRATION_CONNECTION_UPDATED', { connectionId: existing.id, providerId: existing.provider_id });
  return ok(c, row);
});

routes.delete('/connections/:id', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_CONNECT]), async (c) => {
  const existing = await repo().getConnection(c.req.param('id') ?? '');
  if (!existing) return bad(c, 'NOT_FOUND', 'Connection not found.', 404);
  await audit(c, 'SEO_INTEGRATION_CONNECTION_DELETED', { connectionId: existing.id, providerId: existing.provider_id }, { name: existing.name });
  await repo().deleteConnection(existing.id);
  return ok(c, { deleted: true });
});

// ── Credentials (vault) ─────────────────────────────────────────────────────

routes.post('/connections/:id/credentials', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_CREDENTIALS]), async (c) => {
  const body = await json(c);
  if (!body || typeof body.authType !== 'string' || body.secret === undefined || body.secret === null) {
    return bad(c, 'BAD_INPUT', 'authType and secret are required.');
  }
  const connection = await repo().getConnection(c.req.param('id') ?? '');
  if (!connection) return bad(c, 'NOT_FOUND', 'Connection not found.', 404);
  if (!requireCustomConnectorRight(c, connection.provider_id)) {
    return bad(c, 'FORBIDDEN', 'The custom read-only connector requires seo.integrations.custom_connector.', 403);
  }
  const provider = await repo().getProvider(connection.provider_id);
  const allowedAuthTypes = Array.isArray(provider?.auth_types) ? provider.auth_types.map(String) : [];
  if (allowedAuthTypes.length > 0 && !allowedAuthTypes.includes(body.authType)) {
    return bad(c, 'BAD_INPUT', `authType must be one of: ${allowedAuthTypes.join(', ')}.`);
  }
  const v = await vault();
  if (!v) return bad(c, 'VAULT_UNAVAILABLE', 'Credential vault key is not configured (SEO_CREDENTIAL_VAULT_KEY or JWT_SECRET).', 503);
  const { maskOf } = await import('../../../../infrastructure/seo/IntegrationCredentialVault');
  const secretPayload = typeof body.secret === 'object' ? body.secret : { value: String(body.secret) };
  const credential = await repo().addCredential({
    connectionId: connection.id,
    authType: body.authType,
    ciphertext: v.encrypt(secretPayload),
    mask: maskOf(secretPayload.serviceAccountJson ?? secretPayload.apiKey ?? secretPayload.token ?? secretPayload.value ?? secretPayload),
    createdBy: actorId(c),
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  });
  // Honest lifecycle: credentials existing ≠ CONNECTED. OAuth2-only providers
  // still need consent; everything else is CONFIGURING until a test passes.
  const nextStatus = statusAfterCredentialAdd(body.authType, secretPayload as Record<string, unknown>);
  await repo().setConnectionStatus(connection.id, { status: nextStatus });
  await audit(c, 'SEO_INTEGRATION_CREDENTIAL_ADDED', { connectionId: connection.id, providerId: connection.provider_id }, {
    authType: body.authType,
    mask: credential.mask,
    version: credential.version,
  });
  return ok(c, { ...credential, connectionStatus: nextStatus }, 201);
});

routes.get('/connections/:id/credentials', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_CREDENTIALS]), async (c) => {
  const connection = await repo().getConnection(c.req.param('id') ?? '');
  if (!connection) return bad(c, 'NOT_FOUND', 'Connection not found.', 404);
  return ok(c, await repo().listCredentials(connection.id));
});

routes.post('/credentials/:id/revoke', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_CREDENTIALS]), async (c) => {
  const done = await repo().revokeCredential(c.req.param('id') ?? '');
  if (!done) return bad(c, 'NOT_FOUND', 'Credential not found or already revoked/expired.', 404);
  await audit(c, 'SEO_INTEGRATION_CREDENTIAL_REVOKED', {}, { credentialId: c.req.param('id') });
  return ok(c, { revoked: true });
});

// ── Test connection / discovery / resource selection ────────────────────────

routes.post('/connections/:id/test', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_MANAGE]), async (c) => {
  const connection = await repo().getConnection(c.req.param('id') ?? '');
  if (!connection) return bad(c, 'NOT_FOUND', 'Connection not found.', 404);
  if (!requireCustomConnectorRight(c, connection.provider_id)) {
    return bad(c, 'FORBIDDEN', 'The custom read-only connector requires seo.integrations.custom_connector.', 403);
  }
  if (connection.status === 'DISABLED') return bad(c, 'DISABLED', 'Connection is disabled.', 409);
  const provider = await repo().getProvider(connection.provider_id);
  const { adapterFor } = await import('../../../../infrastructure/seo/adapters/SeoIntegrationAdapters');
  const adapter = adapterFor(connection.provider_id);
  if (!adapter) return bad(c, 'NO_ADAPTER', 'No adapter exists for this provider.', 501);

  const usage = await repo().tryConsumeUsage(connection.provider_id, capFor(provider, connection));
  if (!usage.allowed) {
    await repo().setConnectionStatus(connection.id, { status: 'RATE_LIMITED', lastAttemptAt: new Date(), lastError: 'Daily request cap reached.' });
    return bad(c, 'RATE_LIMITED', 'Daily request cap for this provider is exhausted; try again tomorrow.', 429);
  }

  const secret = await decryptActiveSecret(connection.id);
  let result: SeoIntegrationTestResult;
  try {
    result = await adapter.testConnection(asConnectionView(connection), secret);
  } catch (err: any) {
    // Provider failure isolation: adapter exceptions never propagate upward.
    result = { ok: false, stages: [{ stage: 'ENDPOINT', ok: false, detail: String(err?.message ?? err).slice(0, 300) }], errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: String(err?.message ?? err).slice(0, 300) };
  }
  const status = statusForTest(result);
  await repo().setConnectionStatus(connection.id, {
    status,
    lastAttemptAt: new Date(),
    lastError: result.ok ? null : (result.errorMessage ?? null),
  });
  await audit(c, 'SEO_INTEGRATION_CONNECTION_TESTED', { connectionId: connection.id, providerId: connection.provider_id }, {
    ok: result.ok,
    errorCode: result.errorCode ?? null,
    stages: result.stages.map((s) => ({ stage: s.stage, ok: s.ok })),
  });
  return ok(c, { ...result, connectionStatus: status });
});

routes.post('/connections/:id/discover', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_MANAGE]), async (c) => {
  const connection = await repo().getConnection(c.req.param('id') ?? '');
  if (!connection) return bad(c, 'NOT_FOUND', 'Connection not found.', 404);
  const provider = await repo().getProvider(connection.provider_id);
  const { adapterFor } = await import('../../../../infrastructure/seo/adapters/SeoIntegrationAdapters');
  const adapter = adapterFor(connection.provider_id);
  if (!adapter?.discoverResources) return bad(c, 'NOT_SUPPORTED', 'This provider does not support resource discovery.', 501);
  const usage = await repo().tryConsumeUsage(connection.provider_id, capFor(provider, connection));
  if (!usage.allowed) return bad(c, 'RATE_LIMITED', 'Daily request cap for this provider is exhausted.', 429);
  try {
    const resources = await adapter.discoverResources(asConnectionView(connection), await decryptActiveSecret(connection.id));
    await audit(c, 'SEO_INTEGRATION_RESOURCES_DISCOVERED', { connectionId: connection.id, providerId: connection.provider_id }, {
      accounts: resources.accounts?.length ?? 0, properties: resources.properties?.length ?? 0, sites: resources.sites?.length ?? 0,
    });
    return ok(c, resources);
  } catch (err: any) {
    return bad(c, 'DISCOVERY_FAILED', String(err?.message ?? err).slice(0, 300), 502);
  }
});

routes.post('/connections/:id/select-resource', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_CONNECT]), async (c) => {
  const body = await json(c);
  if (!body || (body.accountRef === undefined && body.propertyRef === undefined && body.config === undefined)) {
    return bad(c, 'BAD_INPUT', 'Provide accountRef, propertyRef and/or config.');
  }
  const connection = await repo().getConnection(c.req.param('id') ?? '');
  if (!connection) return bad(c, 'NOT_FOUND', 'Connection not found.', 404);
  const row = await repo().updateConnection(connection.id, {
    accountRef: body.accountRef !== undefined ? (body.accountRef === null ? null : String(body.accountRef)) : undefined,
    propertyRef: body.propertyRef !== undefined ? (body.propertyRef === null ? null : String(body.propertyRef)) : undefined,
    config: body.config && typeof body.config === 'object' ? { ...connection.config, ...body.config } : undefined,
  });
  await audit(c, 'SEO_INTEGRATION_RESOURCE_SELECTED', { connectionId: connection.id, providerId: connection.provider_id }, {
    accountRef: row.account_ref ?? null, propertyRef: row.property_ref ?? null,
  });
  return ok(c, row);
});

// ── Sync operations ─────────────────────────────────────────────────────────

routes.post('/connections/:id/sync', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_MANAGE]), async (c) => {
  const body = (await json(c)) ?? {};
  const connection = await repo().getConnection(c.req.param('id') ?? '');
  if (!connection) return bad(c, 'NOT_FOUND', 'Connection not found.', 404);
  if (!requireCustomConnectorRight(c, connection.provider_id)) {
    return bad(c, 'FORBIDDEN', 'The custom read-only connector requires seo.integrations.custom_connector.', 403);
  }
  if (connection.status === 'DISABLED') return bad(c, 'DISABLED', 'Connection is disabled.', 409);
  if (['NOT_CONFIGURED', 'AUTHORIZATION_REQUIRED'].includes(connection.status)) {
    return bad(c, 'NOT_READY', `Connection is ${connection.status}; add credentials and pass a test first.`, 409);
  }
  const running = await repo().listSyncJobs({ connectionId: connection.id, status: 'RUNNING', limit: 1 });
  const queued = await repo().listSyncJobs({ connectionId: connection.id, status: 'QUEUED', limit: 1 });
  if (running.length > 0 || queued.length > 0) return bad(c, 'ALREADY_RUNNING', 'A sync job is already queued or running for this connection.', 409);

  const jobType = ['BACKFILL', 'INCREMENTAL', 'MANUAL'].includes(body.jobType) ? body.jobType : 'MANUAL';
  const job = await repo().createSyncJob({ connectionId: connection.id, jobType, requestedBy: actorId(c) });
  const queue = QueueService.getInstance().getQueue(QUEUES.ANALYTICS_FANOUT);
  if (!queue) {
    await repo().updateSyncJob(job.id, { status: 'FAILED', completedAt: new Date(), error: 'Queue unavailable — sync never started.' });
    return bad(c, 'QUEUE_UNAVAILABLE', 'Background queue is not available; sync not started.', 503);
  }
  await queue.add('seo-integration-sync', { jobId: job.id, connectionId: connection.id, providerId: connection.provider_id });
  await audit(c, 'SEO_INTEGRATION_SYNC_ENQUEUED', { connectionId: connection.id, providerId: connection.provider_id }, { jobId: job.id, jobType });
  return ok(c, job, 202);
});

routes.post('/sync-jobs/:id/cancel', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_MANAGE]), async (c) => {
  const done = await repo().cancelSyncJob(c.req.param('id') ?? '');
  if (!done) return bad(c, 'NOT_FOUND', 'Job not found or not cancellable.', 404);
  await audit(c, 'SEO_INTEGRATION_SYNC_CANCELLED', {}, { jobId: c.req.param('id') });
  return ok(c, { cancelled: true });
});

routes.get('/sync-jobs', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  return ok(c, await repo().listSyncJobs({
    connectionId: c.req.query('connectionId') || undefined,
    status: c.req.query('status') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
  }));
});

// ── Audit / usage ───────────────────────────────────────────────────────────

routes.get('/audit', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  return ok(c, await repo().listAudit({
    connectionId: c.req.query('connectionId') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
  }));
});

routes.get('/usage', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const providerId = c.req.query('providerId') || undefined;
  const usage = await repo().listUsage(providerId, c.req.query('days') ? Number(c.req.query('days')) : 30);
  const providers = await repo().listProviders();
  const caps = Object.fromEntries(providers.map((p: any) => [p.provider_id, p.manifest?.quota?.dailyRequestCap ?? null]));
  return ok(c, { usage, dailyCaps: caps });
});

// ── Google OAuth2 (PKCE, CSRF-safe) ─────────────────────────────────────────

routes.get('/oauth/google/start', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_MANAGE]), async (c) => {
  const connectionId = c.req.query('connectionId') ?? '';
  const connection = await repo().getConnection(connectionId);
  if (!connection) return bad(c, 'NOT_FOUND', 'Connection not found.', 404);
  const provider = await repo().getProvider(connection.provider_id);
  const scopes = Array.isArray(provider?.manifest?.oauthScopes) ? provider.manifest.oauthScopes.map(String) : [];
  if (scopes.length === 0) return bad(c, 'NOT_OAUTH', 'This provider does not use Google OAuth.', 400);

  const { googleOAuthService } = await import('../../../../infrastructure/seo/GoogleOAuthService');
  const oauth = googleOAuthService();
  const redirectUri = oauth.redirectUri();
  if (!redirectUri) return bad(c, 'NOT_CONFIGURED', 'SEO_OAUTH_REDIRECT_BASE is not set; the OAuth callback URL cannot be built.', 503);

  // Client app: operator-supplied {clientId, clientSecret} in the connection's
  // vault credential, falling back to GOOGLE_OAUTH_CLIENT_ID/SECRET env vars.
  const secret = await decryptActiveSecret(connection.id);
  const app = secret?.clientId && secret?.clientSecret
    ? { clientId: String(secret.clientId), clientSecret: String(secret.clientSecret) }
    : oauth.envClientApp();
  if (!app) {
    await repo().setConnectionStatus(connection.id, { status: 'AUTHORIZATION_REQUIRED', lastError: 'No Google OAuth client app configured (store clientId/clientSecret as a credential or set GOOGLE_OAUTH_CLIENT_ID/SECRET).' });
    return bad(c, 'NO_OAUTH_APP', 'No Google OAuth client app is configured.', 503);
  }
  const { state, verifier } = oauth.createState(connection.id, actorId(c));
  const authUrl = oauth.buildAuthUrl({ clientId: app.clientId, redirectUri, scopes, state, verifier });
  await audit(c, 'SEO_INTEGRATION_OAUTH_STARTED', { connectionId: connection.id, providerId: connection.provider_id });
  return ok(c, { authUrl });
});

// The Google OAuth callback is NOT here. It is a plain browser navigation
// carrying no Authorization header, so it could never pass authMiddleware —
// the button led to a 401 and the connection stayed AUTHORIZATION_REQUIRED
// forever. It now lives on the public router at GET /seo/oauth/google/callback,
// authenticated by the HMAC-signed, single-use, TTL-bound state alone.

export default routes;
