import { Hono } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import type { ConsentState } from '../../../../domain/consent/ConsentFoundation';
import {
  CONSENT_CHANNEL_KEYS,
  CONSENT_PURPOSE_KEYS,
  type ConsentChannelKey,
  type ConsentPurposeKey,
} from '../../../../application/ports/consent/ConsentOperatingRepository';
import { getConsentOperatingRuntime } from '../../../../infrastructure/consent/ConsentOperatingRuntime';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';

// audit-exempt: mutations use the dedicated immutable consent audit envelope and transactional event channel.
type Variables = { user: { id: string; email: string; permissions: string[] } };
const routes = new Hono<{ Variables: Variables }>();
routes.use('*', authMiddleware);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parsePurpose(value: unknown): ConsentPurposeKey {
  const purpose = String(value ?? '');
  if (!CONSENT_PURPOSE_KEYS.includes(purpose as ConsentPurposeKey)) throw new Error('invalid_purpose_key');
  return purpose as ConsentPurposeKey;
}

function parseChannel(value: unknown): ConsentChannelKey {
  const channel = String(value ?? '');
  if (!CONSENT_CHANNEL_KEYS.includes(channel as ConsentChannelKey)) throw new Error('invalid_channel_key');
  return channel as ConsentChannelKey;
}

function mutationHeaders(c: { req: { header(name: string): string | undefined } }) {
  const correlation_id = c.req.header('x-correlation-id')?.trim();
  const idempotency_key = c.req.header('idempotency-key')?.trim();
  if (!correlation_id || !idempotency_key) throw new Error('correlation_id_and_idempotency_key_required');
  return { correlation_id, idempotency_key };
}

routes.get('/readiness', requirePermissions([PERMISSIONS.AUDIT_READ]), c => {
  const runtime = getConsentOperatingRuntime();
  return c.json(runtime.noSendReleaseReadiness.evaluate(runtime.gates));
});

routes.get('/overview', requirePermissions([PERMISSIONS.AUDIT_READ]), async c => {
  const runtime = getConsentOperatingRuntime();
  if (!runtime.gates.CONSENT_ADMIN_WORKFLOW_ENABLED) {
    return c.json({ status: 'disabled', reasons: ['consent_admin_workflow_enabled_is_disabled'] }, 503);
  }
  const [purposes, channels, source_surfaces] = await Promise.all([
    runtime.repository.listPurposes(),
    runtime.repository.listChannels(),
    runtime.repository.listSourceSurfaces(),
  ]);
  return c.json({ status: 'available', purposes, channels, source_surfaces, live_sends: 'blocked' });
});

routes.get('/timeline/:customerRef', requirePermissions([PERMISSIONS.AUDIT_READ]), async c => {
  const runtime = getConsentOperatingRuntime();
  if (!runtime.gates.CONSENT_ADMIN_WORKFLOW_ENABLED) {
    return c.json({ status: 'disabled', timeline: [], reasons: ['consent_admin_workflow_enabled_is_disabled'] }, 503);
  }
  return c.json({
    status: 'available',
    timeline: await runtime.repository.queryAuditTimeline(c.req.param('customerRef') ?? ''),
  });
});

routes.get('/support/requests', requirePermissions([PERMISSIONS.AUDIT_READ]), async c => {
  const runtime = getConsentOperatingRuntime();
  if (!runtime.gates.CONSENT_SUPPORT_WORKFLOW_ENABLED) {
    return c.json({ status: 'disabled', requests: [], reasons: ['consent_support_workflow_enabled_is_disabled'] }, 503);
  }
  return c.json({ status: 'available', requests: await runtime.repository.listSupportAssistedRequests() });
});

routes.post('/support/requests', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async c => {
  const runtime = getConsentOperatingRuntime();
  let body: Record<string, unknown>;
  try {
    body = asRecord(await c.req.json());
    const user = c.get('user');
    const headers = mutationHeaders(c);
    const result = await runtime.recordSupportAssistedPreferenceRequest.execute({
      customer_identity_ref: String(body.customer_identity_ref ?? ''),
      endpoint_ref: String(body.endpoint_ref ?? ''),
      purpose_key: parsePurpose(body.purpose_key),
      channel_key: parseChannel(body.channel_key),
      requested_state: body.requested_state === 'withdrawn' ? 'withdrawn' : 'requested_support_assisted',
      identity_level: 'support_verified_contact',
      verification_status: String(body.verification_status ?? 'pending'),
      support_ticket_ref: String(body.support_ticket_ref ?? ''),
      actor_type: 'support_operator',
      actor_id: user.id,
      script_copy_version_id: String(body.script_copy_version_id ?? ''),
      correlation_id: headers.correlation_id,
      idempotency_key: headers.idempotency_key,
      expires_at: String(body.expires_at ?? ''),
    });
    return c.json(result, result.ok ? 201 : 422);
  } catch (error) {
    return c.json({ ok: false, status: 'rejected', reasons: [error instanceof Error ? error.message : 'invalid_request'] }, 400);
  }
});

routes.post('/conflicts/preview', requirePermissions([PERMISSIONS.AUDIT_READ]), async c => {
  const runtime = getConsentOperatingRuntime();
  if (!runtime.gates.CONSENT_ADMIN_WORKFLOW_ENABLED) {
    return c.json({ status: 'disabled', reasons: ['consent_admin_workflow_enabled_is_disabled'] }, 503);
  }
  const body = asRecord(await c.req.json());
  const states = Array.isArray(body.competing_states) ? body.competing_states.map(String) : [];
  const resolution = states.includes('blocked_by_policy')
    ? 'blocked_by_policy'
    : states.includes('withdrawn')
      ? 'withdrawn'
      : 'unknown';
  return c.json({ status: 'preview', resolution, persisted: false, audit_required_for_resolution: true });
});

routes.post('/conflicts/resolve', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async c => {
  const runtime = getConsentOperatingRuntime();
  try {
    const body = asRecord(await c.req.json());
    const user = c.get('user');
    const result = await runtime.resolveConsentConflict.execute({
      customer_identity_ref: String(body.customer_identity_ref ?? ''),
      endpoint_ref: String(body.endpoint_ref ?? ''),
      purpose_key: parsePurpose(body.purpose_key),
      channel_key: parseChannel(body.channel_key),
      actor_type: 'admin',
      actor_id: user.id,
      identity_level: 'admin_operator_confirmed',
      ...mutationHeaders(c),
      reason: String(body.reason ?? ''),
      source_surface: 'admin_consent_conflict_resolution',
      copy_version_id: body.copy_version_id ? String(body.copy_version_id) : null,
      competing_states: Array.isArray(body.competing_states) ? body.competing_states.map(String) as ConsentState[] : [],
    });
    return c.json(result, result.ok ? 200 : 422);
  } catch (error) {
    return c.json({ ok: false, status: 'rejected', reasons: [error instanceof Error ? error.message : 'invalid_request'] }, 400);
  }
});

routes.post('/manual-corrections', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async c => {
  const runtime = getConsentOperatingRuntime();
  try {
    const body = asRecord(await c.req.json());
    const user = c.get('user');
    const result = await runtime.supersedeConsentState.execute({
      customer_identity_ref: String(body.customer_identity_ref ?? ''),
      endpoint_ref: String(body.endpoint_ref ?? ''),
      purpose_key: parsePurpose(body.purpose_key),
      channel_key: parseChannel(body.channel_key),
      actor_type: 'admin',
      actor_id: user.id,
      identity_level: 'admin_operator_confirmed',
      ...mutationHeaders(c),
      reason: String(body.reason ?? ''),
      source_surface: 'admin_manual_correction',
      copy_version_id: body.copy_version_id ? String(body.copy_version_id) : null,
      proposed_state: String(body.proposed_state ?? 'unknown') as ConsentState,
    });
    return c.json(result, result.ok ? 200 : 422);
  } catch (error) {
    return c.json({ ok: false, status: 'rejected', reasons: [error instanceof Error ? error.message : 'invalid_request'] }, 400);
  }
});

routes.post('/legacy-migration/dry-run', requirePermissions([PERMISSIONS.AUDIT_READ]), async c => {
  const runtime = getConsentOperatingRuntime();
  if (!runtime.gates.CONSENT_LEGACY_MIGRATION_DRY_RUN_ENABLED) {
    return c.json({ status: 'disabled', reasons: ['consent_legacy_migration_dry_run_enabled_is_disabled'] }, 503);
  }
  const body = asRecord(await c.req.json());
  const candidates = Array.isArray(body.candidates)
    ? body.candidates.map(value => {
      const candidate = asRecord(value);
      return {
        customer_ref: String(candidate.customer_ref ?? ''),
        source: String(candidate.source ?? 'legacy_account_preferences'),
        field: String(candidate.field ?? ''),
        value: candidate.value,
      };
    })
    : [];
  return c.json({ status: 'dry_run', writes_performed: 0, ...runtime.legacyMigrationDryRun.execute(candidates) });
});

routes.get('/suppressions', requirePermissions([PERMISSIONS.AUDIT_READ]), async c => {
  const runtime = getConsentOperatingRuntime();
  if (!runtime.gates.CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED) {
    return c.json({ status: 'disabled', suppressions: [], reasons: ['consent_provider_suppression_intake_enabled_is_disabled'] }, 503);
  }
  return c.json({ status: 'available', suppressions: await runtime.repository.listChannelSuppressions() });
});

routes.post('/provider-suppressions', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async c => {
  const runtime = getConsentOperatingRuntime();
  try {
    const body = asRecord(await c.req.json());
    const headers = mutationHeaders(c);
    const input = {
      customer_identity_ref: body.customer_identity_ref ? String(body.customer_identity_ref) : null,
      endpoint_ref: String(body.endpoint_ref ?? ''),
      channel_key: parseChannel(body.channel_key),
      purpose_key: body.purpose_key ? parsePurpose(body.purpose_key) : null,
      scope: body.scope === 'purpose' ? 'purpose' as const : 'channel' as const,
      reason: String(body.reason ?? ''),
      source_surface: 'verified_provider_suppression_intake',
      provider_callback_ref: String(body.provider_callback_ref ?? ''),
      ...headers,
      effective_at: String(body.effective_at ?? new Date().toISOString()),
      provider_key: String(body.provider_key ?? ''),
      provider_event_ref: String(body.provider_event_ref ?? ''),
      authenticity_verified: body.authenticity_verified === true,
      freshness_verified: body.freshness_verified === true,
      provider_occurred_at: String(body.provider_occurred_at ?? ''),
      normalized_evidence: {
        event_type: String(body.event_type ?? 'unsubscribe'),
        scope: String(body.scope ?? 'channel'),
        verification_profile: String(body.verification_profile ?? ''),
      },
    };
    const result = body.event_type === 'stop'
      ? await runtime.recordProviderStopSignal.execute(input)
      : await runtime.recordProviderUnsubscribeSignal.execute(input);
    return c.json(result, result.ok ? 201 : 422);
  } catch (error) {
    return c.json({ ok: false, status: 'rejected', reasons: [error instanceof Error ? error.message : 'invalid_request'] }, 400);
  }
});

routes.post('/provider-eligibility/dry-run', requirePermissions([PERMISSIONS.AUDIT_READ]), async c => {
  const runtime = getConsentOperatingRuntime();
  try {
    const body = asRecord(await c.req.json());
    const result = await runtime.previewProviderEligibility.execute({
      customer_identity_ref: String(body.customer_identity_ref ?? ''),
      endpoint_ref: String(body.endpoint_ref ?? ''),
      purpose_key: parsePurpose(body.purpose_key),
      channel_key: parseChannel(body.channel_key),
    });
    return c.json({ ...result, send_attempted: false, provider_transport_called: false }, result.ok ? 200 : 422);
  } catch (error) {
    return c.json({ ok: false, status: 'rejected', reasons: [error instanceof Error ? error.message : 'invalid_request'] }, 400);
  }
});

export default routes;
