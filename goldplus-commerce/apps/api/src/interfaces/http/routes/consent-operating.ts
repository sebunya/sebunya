import { Context, Hono } from 'hono';
import { getConsentOperatingRuntime } from '../../../infrastructure/consent/ConsentOperatingRuntime';
import {
  CONSENT_CHANNEL_KEYS,
  CONSENT_PURPOSE_KEYS,
  type ConsentChannelKey,
  type ConsentPurposeKey,
} from '../../../application/ports/consent/ConsentOperatingRepository';
import { customerSessionMiddleware } from '../middleware/customerSession';
import { authorizePilotPreferenceSave, hashPilotIdentity, parsePilotAllowlist } from '../../../application/services/consent/ConsentPilotRing';

type Variables = { userId: string; userEmail: string };
const routes = new Hono<{ Variables: Variables }>();
routes.use('*', customerSessionMiddleware);

function gateDisabled(c: Context<{ Variables: Variables }>, gate: string) {
  return c.json({
    success: false,
    data: { status: 'disabled', saved: false, reasons: [`${gate.toLowerCase()}_is_disabled`] },
  }, 503);
}

function parseKey(c: { req: { query(name: string): string | undefined }; get(name: 'userId'): string }) {
  const purpose = c.req.query('purpose_key') ?? '';
  const channel = c.req.query('channel_key') ?? '';
  if (!CONSENT_PURPOSE_KEYS.includes(purpose as ConsentPurposeKey)) throw new Error('invalid_purpose_key');
  if (!CONSENT_CHANNEL_KEYS.includes(channel as ConsentChannelKey)) throw new Error('invalid_channel_key');
  return {
    customer_identity_ref: c.get('userId'),
    endpoint_ref: `account:${c.get('userId')}:${channel}`,
    purpose_key: purpose as ConsentPurposeKey,
    channel_key: channel as ConsentChannelKey,
  };
}

routes.get('/current', async c => {
  const runtime = getConsentOperatingRuntime();
  if (!runtime.gates.CONSENT_PERSISTENCE_COMMANDS_ENABLED) {
    return gateDisabled(c, 'CONSENT_PERSISTENCE_COMMANDS_ENABLED');
  }

  try {
    const state = await runtime.repository.getLatestConsentState(parseKey(c));
    return c.json({ success: true, data: { status: state ? 'available' : 'not_recorded', state } });
  } catch (error) {
    return c.json({ success: false, data: { status: 'rejected', reasons: [error instanceof Error ? error.message : 'invalid_request'] } }, 400);
  }
});

routes.post('/preferences', async c => {
  const runtime = getConsentOperatingRuntime();
  if (!runtime.gates.CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED) {
    return gateDisabled(c, 'CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED');
  }
  if (!runtime.gates.CONSENT_PERSISTENCE_COMMANDS_ENABLED) {
    return gateDisabled(c, 'CONSENT_PERSISTENCE_COMMANDS_ENABLED');
  }

  const correlationId = c.req.header('x-correlation-id')?.trim();
  const idempotencyKey = c.req.header('idempotency-key')?.trim();
  if (!correlationId || !idempotencyKey) {
    return c.json({
      success: false,
      data: { status: 'rejected', saved: false, reasons: ['correlation_id_and_idempotency_key_required'] },
    }, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, data: { status: 'rejected', saved: false, reasons: ['valid_json_required'] } }, 400);
  }

  const purpose = String(body.purpose_key ?? '');
  const channel = String(body.channel_key ?? '');
  if (!CONSENT_PURPOSE_KEYS.includes(purpose as ConsentPurposeKey) || !CONSENT_CHANNEL_KEYS.includes(channel as ConsentChannelKey)) {
    return c.json({ success: false, data: { status: 'rejected', saved: false, reasons: ['invalid_purpose_or_channel'] } }, 400);
  }
  if (body.requested_state !== 'granted' && body.requested_state !== 'withdrawn') {
    return c.json({ success: false, data: { status: 'rejected', saved: false, reasons: ['explicit_grant_or_withdrawal_required'] } }, 400);
  }

  const pilotAllowlist = parsePilotAllowlist(process.env.CONSENT_PILOT_ALLOWLIST_HASHES);
  const identityAllowlisted = pilotAllowlist.some(record => record.identity_hash === hashPilotIdentity(c.get('userId')));
  const pilotAuthorized = authorizePilotPreferenceSave({
    pilot_save_enabled: runtime.gates.CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED,
    identity_ring: identityAllowlisted ? 'ring_1_allowlisted_verified_pilot' : 'ring_2_public_read_only',
    identity_classification: 'verified_account',
    identity_verified: true,
    identity_allowlisted: identityAllowlisted,
    purpose_key: purpose,
    channel_key: channel,
    requested_state: body.requested_state,
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
    copy_version: String(body.copy_version_id ?? ''),
    source_surface: 'account_preference_centre_p0',
    audit_required: true,
    provider_live_sends: runtime.gates.CONSENT_PROVIDER_LIVE_SENDS_ENABLED,
    provider_transport_requested: false,
  });
  if (!pilotAuthorized.ok) return c.json({ success: false, data: { status: 'rejected', saved: false, reasons: pilotAuthorized.reasons } }, 403);

  const commandInput = {
    customer_identity_ref: c.get('userId'),
    endpoint_ref: `account:${c.get('userId')}:${channel}`,
    purpose_key: purpose as ConsentPurposeKey,
    channel_key: channel as ConsentChannelKey,
    actor_type: 'customer' as const,
    actor_id: c.get('userId'),
    identity_level: 'verified_account' as const,
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
    reason: String(body.reason ?? 'customer preference centre update'),
    source_surface: 'account_preference_centre_p0',
    copy_version_id: body.copy_version_id ? String(body.copy_version_id) : null,
    optional_marketing: purpose === 'marketing_offers_campaigns',
  };
  const result = body.requested_state === 'withdrawn'
    ? await runtime.recordConsentWithdrawal.execute(commandInput)
    : await runtime.recordConsentGrant.execute(commandInput);
  const saved = result.ok && result.status === 'persisted';
  return c.json({ success: saved, data: { ...result, saved } }, saved ? 200 : 422);
});

export default routes;
