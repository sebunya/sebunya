import { createHash } from 'node:crypto';
import {
  WHATSAPP_CHANNEL, WHATSAPP_MARKETING_COPY, WHATSAPP_MARKETING_COPY_VERSION, WHATSAPP_MARKETING_PURPOSE, WHATSAPP_MARKETING_SOURCE_SURFACE,
  WhatsAppChangeRequest, maskE164, mayReceiveWhatsAppMarketing, planWhatsAppMarketingChange, whatsappMarketingCopyHash, whatsappMarketingStatus,
} from '../../../domain/consent/WhatsAppMarketingConsent';
import { normalisePhoneE164 } from '../../../domain/customer-dna/IdentityStitching';
import type { ConsentAggregateKey, ConsentOperatingRepository } from '../../ports/consent/ConsentOperatingRepository';
import type { IAccountIdentityReader, IConsentEvidenceRepository, IIdentifierHasher, IWhatsAppMarketingGate } from '../../ports/first-party/FirstPartyPorts';

const keyFor = (userId: string): ConsentAggregateKey => ({
  customer_identity_ref: userId,
  endpoint_ref: `account:${userId}:${WHATSAPP_CHANNEL}`,
  purpose_key: WHATSAPP_MARKETING_PURPOSE,
  channel_key: WHATSAPP_CHANNEL,
});

/** Stable per (user, idempotency key): a double-submitted form records one event. */
function eventIdFor(userId: string, idempotencyKey: string): string {
  const hex = createHash('sha256').update(`whatsapp_marketing:${userId}:${idempotencyKey}`, 'utf8').digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The customer's own WhatsApp marketing choice (preference centre), and the
 * gate messaging reads. Not behind the consent pilot gates: RECORDING a
 * choice sends nothing, and the owner asked for this purpose to exist.
 */
export class WhatsAppMarketingConsentUseCases implements IWhatsAppMarketingGate {
  constructor(
    private readonly consent: ConsentOperatingRepository,
    private readonly evidence: IConsentEvidenceRepository,
    private readonly accounts: IAccountIdentityReader,
    private readonly hasher: IIdentifierHasher,
  ) {}

  async status(userId: string) {
    const account = await this.accounts.findAccount(userId);
    const phone = normalisePhoneE164(account?.phone);
    const state = await this.consent.getLatestConsentState(keyFor(userId));
    const gate = await this.mayMarket(userId);
    return {
      status: whatsappMarketingStatus(state?.state ?? null),
      since: state?.effective_at ?? null,
      phoneMasked: phone ? maskE164(phone) : null,
      hasPhone: !!phone,
      /** True only when the opt-in covers the number on the account today. */
      covered: gate.allowed,
      coverageReason: gate.reason,
      copy: WHATSAPP_MARKETING_COPY,
      copyVersionId: WHATSAPP_MARKETING_COPY_VERSION,
    };
  }

  async change(input: {
    userId: string; requested: WhatsAppChangeRequest; confirmationTicked: boolean; copyVersionId: string | null;
    idempotencyKey: string; correlationId: string; ipAddress?: string | null; userAgent?: string | null;
  }): Promise<{ ok: true; status: ReturnType<typeof whatsappMarketingStatus>; alreadyApplied: boolean } | { ok: false; code: string; message: string }> {
    if (!input.idempotencyKey?.trim() || !input.correlationId?.trim()) return { ok: false, code: 'BAD_INPUT', message: 'Missing request identifiers.' };
    const account = await this.accounts.findAccount(input.userId);
    if (!account) return { ok: false, code: 'SIGNED_IN_ACCOUNT_REQUIRED', message: 'Sign in to change this.' };
    const phone = normalisePhoneE164(account.phone);
    const key = keyFor(input.userId);
    const current = await this.consent.getLatestConsentState(key);
    const plan = planWhatsAppMarketingChange({
      current: current?.state ?? null, requested: input.requested, confirmationTicked: input.confirmationTicked,
      copyVersionId: input.copyVersionId, signedInAccount: true, phoneE164: phone,
    });
    if (!plan.ok) {
      const message: Record<string, string> = {
        CONFIRMATION_REQUIRED: 'Tick the box to confirm you want offers on WhatsApp.',
        PHONE_REQUIRED: 'Add a Ugandan phone number to your account first.',
        SIGNED_IN_ACCOUNT_REQUIRED: 'Sign in to change this.',
        BLOCKED_BY_POLICY: 'This choice cannot be changed online. Please contact support.',
        COPY_VERSION_MISMATCH: 'The wording changed while the page was open. Reload the page and try again.',
      };
      return { ok: false, code: plan.reason, message: message[plan.reason] ?? 'That choice was not saved.' };
    }
    if (plan.noOp) return { ok: true, status: whatsappMarketingStatus(plan.next), alreadyApplied: true };

    const consentEventId = eventIdFor(input.userId, input.idempotencyKey);
    const receipt = await this.consent.commitStateChange({
      ...key,
      consent_event_id: consentEventId,
      event_type: plan.eventType,
      state: plan.next,
      previous_state: current?.state ?? null,
      new_state: plan.next,
      identity_level: 'verified_account',
      source_surface: WHATSAPP_MARKETING_SOURCE_SURFACE,
      actor_type: 'customer',
      actor_id: input.userId,
      copy_version_id: WHATSAPP_MARKETING_COPY_VERSION,
      reason: input.requested === 'granted' ? 'customer ticked the WhatsApp offers box in the preference centre' : 'customer switched WhatsApp offers off in the preference centre',
      correlation_id: input.correlationId,
      idempotency_key: input.idempotencyKey,
      provider_callback_ref: null,
      support_ticket_ref: null,
      retention_policy: 'consent-audit-v1',
      effective_at: new Date().toISOString(),
    });
    if (!receipt.already_applied) {
      const hashOrNull = (v: string | null | undefined) => (v ? this.hasher.hash(v) : null);
      await this.evidence.record({
        consentEventId,
        purposeKey: WHATSAPP_MARKETING_PURPOSE,
        channelKey: WHATSAPP_CHANNEL,
        endpointHash: phone ? this.hasher.hash(phone) : null,
        endpointMasked: phone ? maskE164(phone) : null,
        copyVersionId: WHATSAPP_MARKETING_COPY_VERSION,
        copyTextHash: whatsappMarketingCopyHash(),
        confirmation: input.requested === 'granted' ? 'CHECKBOX_TICKED' : 'WITHDRAW_BUTTON',
        ipHash: hashOrNull(input.ipAddress?.trim() || null),
        userAgentHash: hashOrNull(input.userAgent?.trim().slice(0, 512) || null),
        sourceSurface: WHATSAPP_MARKETING_SOURCE_SURFACE,
      });
    }
    return { ok: true, status: whatsappMarketingStatus(receipt.state), alreadyApplied: receipt.already_applied };
  }

  /** The messaging gate. Transactional messages never call this. */
  async mayMarket(accountUserId: string): Promise<{ allowed: boolean; reason: string; phoneE164: string | null }> {
    const account = await this.accounts.findAccount(accountUserId);
    const phone = normalisePhoneE164(account?.phone);
    const row = await this.consent.getLatestConsentState(keyFor(accountUserId));
    const consentedPhoneHash = row?.state === 'granted' && row.last_consent_event_id
      ? (await this.evidence.latestFor(row.last_consent_event_id))?.endpointHash ?? null
      : null;
    const gate = mayReceiveWhatsAppMarketing({ state: row?.state ?? null, consentedPhoneHash, currentPhoneHash: phone ? this.hasher.hash(phone) : null });
    return { ...gate, phoneE164: gate.allowed ? phone : null };
  }
}
