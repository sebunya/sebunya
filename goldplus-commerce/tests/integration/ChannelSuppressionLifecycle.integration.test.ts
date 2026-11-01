import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fixtures } from './helpers/fixtures';

/**
 * A STOP recorded against a contact must block marketing to it, and a lift
 * must undo exactly that. An operator-recorded STOP carries only the phone
 * number or email address it came from (no account), which is the case the
 * campaign gate used to miss: it looked suppressions up by account id only.
 *
 * Real PostgreSQL: the repositories' SQL is what is under test.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('channel suppression: record, enforce by contact, lift (real PostgreSQL)', () => {
  let raw: any;
  let consent: any;
  let sends: any;
  let fx: Fixtures;
  let userId: string;
  const local = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
  const phone = `+2567${local}`;
  const phoneRef = `phone:${phone}`;
  let email: string;
  const ids: string[] = [];

  const record = async (endpointRef: string, channel: 'sms' | 'email' | 'whatsapp') => {
    const out = await consent.recordChannelSuppression({
      customer_identity_ref: null,
      endpoint_ref: endpointRef,
      channel_key: channel,
      purpose_key: null,
      scope: 'channel',
      reason: 'Customer replied STOP',
      source_surface: 'verified_provider_suppression_intake',
      provider_callback_ref: `operator-intake:${randomUUID()}`,
      correlation_id: randomUUID(),
      idempotency_key: randomUUID(),
      effective_at: new Date().toISOString(),
    });
    ids.push(out.suppression_id);
    return out.suppression_id as string;
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    const { DrizzleConsentOperatingRepository } = await import('../../apps/api/src/infrastructure/consent/DrizzleConsentOperatingRepository');
    const { DrizzleCampaignSendRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleCampaignSendRepository');
    consent = new DrizzleConsentOperatingRepository();
    sends = new DrizzleCampaignSendRepository();
    fx = new Fixtures(raw);
    userId = await fx.user();
    await raw`update users set phone = ${`07${local}`} where id = ${userId}`;
    [{ email }] = await raw`select email from users where id = ${userId}`;
  });

  afterAll(async () => {
    if (!raw) return;
    if (ids.length) await raw`delete from channel_suppressions where id = any(${ids})`;
    await fx.cleanup();
    await raw.end();
  });

  it('an SMS STOP keyed by phone number suppresses the account that owns the number, on SMS only', async () => {
    expect(await consent.hasActiveChannelSuppression([phoneRef], 'sms', 'marketing_offers_campaigns')).toBe(false);
    expect((await sends.suppressedUserIds([userId], 'sms')).has(userId)).toBe(false);

    await record(phoneRef, 'sms');

    expect(await consent.hasActiveChannelSuppression([phoneRef], 'sms', 'marketing_offers_campaigns')).toBe(true);
    expect((await sends.suppressedUserIds([userId], 'sms')).has(userId)).toBe(true);
    expect(await consent.hasActiveChannelSuppression([phoneRef], 'email', 'marketing_offers_campaigns')).toBe(false);
    expect((await sends.suppressedUserIds([userId], 'email')).has(userId)).toBe(false);
  });

  it('an email unsubscribe keyed by address suppresses the account on email', async () => {
    await record(`email:${email.toLowerCase()}`, 'email');
    expect((await sends.suppressedUserIds([userId], 'email')).has(userId)).toBe(true);
  });

  it('lifting one row ends every active suppression for that contact and channel, and nothing else', async () => {
    const second = await record(phoneRef, 'sms'); // the same customer sent STOP twice
    const lifted = await consent.liftChannelSuppression(second, { actorId: 'admin-7', reason: 'customer asked to hear from us again' });
    expect(lifted).toMatchObject({ endpoint_ref: phoneRef, channel_key: 'sms', lifted: 2 });

    expect(await consent.hasActiveChannelSuppression([phoneRef], 'sms', 'marketing_offers_campaigns')).toBe(false);
    expect((await sends.suppressedUserIds([userId], 'sms')).has(userId)).toBe(false);
    // The email unsubscribe is a different channel and still stands.
    expect((await sends.suppressedUserIds([userId], 'email')).has(userId)).toBe(true);
    // Rows are kept, each with who lifted it, when and why.
    const rows = await raw`select lifted_at, lifted_by, lift_reason from channel_suppressions where endpoint_ref = ${phoneRef} and suppression_active = false`;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.lifted_by).toBe('admin-7');
      expect(r.lift_reason).toBe('customer asked to hear from us again');
      expect(r.lifted_at).toBeInstanceOf(Date);
    }
    // A suppression that still stands carries no lift evidence.
    const [standing] = await raw`select lifted_at from channel_suppressions where endpoint_ref = ${`email:${email.toLowerCase()}`} and suppression_active = true`;
    expect(standing.lifted_at).toBeNull();
  });

  it('re-sending the request that created a lifted suppression is refused, not reported as recorded', async () => {
    const write = {
      customer_identity_ref: null, endpoint_ref: `phone:+2567${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`,
      channel_key: 'sms' as const, purpose_key: null, scope: 'channel' as const, reason: 'Customer replied STOP',
      source_surface: 'verified_provider_suppression_intake', provider_callback_ref: `operator-intake:${randomUUID()}`,
      correlation_id: randomUUID(), idempotency_key: randomUUID(), effective_at: new Date().toISOString(),
    };
    const { suppression_id } = await consent.recordChannelSuppression(write);
    ids.push(suppression_id);
    // An honest retry while it is still active is idempotent.
    expect((await consent.recordChannelSuppression(write)).suppression_id).toBe(suppression_id);
    await consent.liftChannelSuppression(suppression_id, { actorId: 'admin-7', reason: 'wrong contact' });
    await expect(consent.recordChannelSuppression(write)).rejects.toThrow(/suppression_was_lifted/);
    expect(await consent.hasActiveChannelSuppression([write.endpoint_ref], 'sms', 'marketing_offers_campaigns')).toBe(false);
  });

  it('the eligibility preview stops reporting a suppression once it is lifted', async () => {
    const key = { customer_identity_ref: `it-${randomUUID()}`, endpoint_ref: phoneRef, channel_key: 'sms' as const, purpose_key: 'marketing_offers_campaigns' as const };
    expect((await consent.buildDryRunEligibilityInput(key)).provider_suppression_active).toBe(false);
    const again = await record(phoneRef, 'sms');
    // The provider evidence row that accompanies a STOP, as the intake command writes it.
    await consent.recordProviderUnsubscribeEvent({
      customer_identity_ref: null, endpoint_ref: phoneRef, channel_key: 'sms', purpose_key: null, scope: 'channel',
      reason: 'Customer replied STOP', source_surface: 'verified_provider_suppression_intake',
      provider_callback_ref: `operator-intake:${randomUUID()}`, correlation_id: randomUUID(), idempotency_key: randomUUID(),
      effective_at: new Date().toISOString(), provider_key: 'zoho_cpaas', provider_event_ref: `it-${randomUUID()}`,
      authenticity_verified: true, freshness_verified: true, provider_occurred_at: new Date().toISOString(),
      normalized_evidence: { event_type: 'stop', scope: 'channel', verification_profile: 'operator_console_attestation' },
    });
    expect((await consent.buildDryRunEligibilityInput(key)).provider_suppression_active).toBe(true);
    await consent.liftChannelSuppression(again, { actorId: 'admin-7', reason: 'wrong contact' });
    expect((await consent.buildDryRunEligibilityInput(key)).provider_suppression_active).toBe(false);
  });

  it('lifting an unknown or already lifted suppression changes nothing', async () => {
    const by = { actorId: 'admin-7', reason: 'second attempt' };
    expect(await consent.liftChannelSuppression(randomUUID(), by)).toBeNull();
    expect(await consent.liftChannelSuppression(ids[0], by)).toBeNull();
    const [first] = await raw`select lift_reason from channel_suppressions where id = ${ids[0]}`;
    expect(first.lift_reason).toBe('customer asked to hear from us again');
  });
});
