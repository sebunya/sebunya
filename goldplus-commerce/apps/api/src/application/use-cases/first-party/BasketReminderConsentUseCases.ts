import { createHash } from 'node:crypto';
import {
  BASKET_REMINDERS_CHANNEL, BASKET_REMINDERS_COPY, BASKET_REMINDERS_COPY_VERSION, BASKET_REMINDERS_PURPOSE, BASKET_REMINDERS_SURFACES,
  type BasketReminderSurface, basketReminderStatus, basketRemindersCopyHash, mayReceiveBasketReminder, planBasketReminderChange,
} from '../../../domain/consent/BasketReminderConsent';
import { maskE164 } from '../../../domain/consent/WhatsAppMarketingConsent';
import { normalisePhoneE164 } from '../../../domain/customer-dna/IdentityStitching';
import type { ConsentAggregateKey, ConsentOperatingRepository } from '../../ports/consent/ConsentOperatingRepository';
import type { IAccountIdentityReader, IConsentEvidenceRepository, IIdentifierHasher } from '../../ports/first-party/FirstPartyPorts';

const keyFor = (userId: string): ConsentAggregateKey => ({
  customer_identity_ref: userId,
  endpoint_ref: `account:${userId}:${BASKET_REMINDERS_CHANNEL}`,
  purpose_key: BASKET_REMINDERS_PURPOSE,
  channel_key: BASKET_REMINDERS_CHANNEL,
});

function eventIdFor(userId: string, idempotencyKey: string): string {
  const hex = createHash('sha256').update(`basket_reminders:${userId}:${idempotencyKey}`, 'utf8').digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The reminder gate: who may be texted about a basket, and at which number. */
export interface IBasketReminderGate {
  mayRemind(userId: string): Promise<{ allowed: boolean; reason: string; phoneE164: string | null }>;
}

/**
 * The customer's own basket-reminder choice (0210): the sign-up tick, the
 * preference centre switch, and the gate the reminder reads. Recording a
 * choice sends nothing.
 */
export class BasketReminderConsentUseCases implements IBasketReminderGate {
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
    const gate = await this.mayRemind(userId).catch(() => ({ allowed: false, reason: 'UNREADABLE', phoneE164: null }));
    return {
      status: basketReminderStatus(state?.state ?? null),
      since: state?.effective_at ?? null,
      phoneMasked: phone ? maskE164(phone) : null,
      hasPhone: !!phone,
      covered: gate.allowed,
      coverageReason: gate.reason,
      copy: BASKET_REMINDERS_COPY,
      copyVersionId: BASKET_REMINDERS_COPY_VERSION,
    };
  }

  async change(input: {
    userId: string; requested: 'granted' | 'withdrawn'; confirmationTicked: boolean; copyVersionId: string | null;
    surface: BasketReminderSurface; idempotencyKey: string; correlationId: string; ipAddress?: string | null; userAgent?: string | null;
  }): Promise<{ ok: true; status: ReturnType<typeof basketReminderStatus>; alreadyApplied: boolean } | { ok: false; code: string; message: string }> {
    if (!input.idempotencyKey?.trim() || !input.correlationId?.trim()) return { ok: false, code: 'BAD_INPUT', message: 'Missing request identifiers.' };
    const account = await this.accounts.findAccount(input.userId);
    if (!account) return { ok: false, code: 'SIGNED_IN_ACCOUNT_REQUIRED', message: 'Sign in to change this.' };
    const phone = normalisePhoneE164(account.phone);
    const key = keyFor(input.userId);
    const current = await this.consent.getLatestConsentState(key);
    const plan = planBasketReminderChange({
      current: current?.state ?? null, requested: input.requested, confirmationTicked: input.confirmationTicked,
      copyVersionId: input.copyVersionId, signedInAccount: true, phoneE164: phone,
    });
    if (!plan.ok) {
      const message: Record<string, string> = {
        CONFIRMATION_REQUIRED: 'Tick the box to confirm you want basket reminders by text.',
        PHONE_REQUIRED: 'Add a Ugandan phone number to your account first.',
        SIGNED_IN_ACCOUNT_REQUIRED: 'Sign in to change this.',
        BLOCKED_BY_POLICY: 'This choice cannot be changed online. Please contact support.',
        COPY_VERSION_MISMATCH: 'The wording changed while the page was open. Reload the page and try again.',
      };
      return { ok: false, code: plan.reason, message: message[plan.reason] ?? 'That choice was not saved.' };
    }
    if (plan.noOp) return { ok: true, status: basketReminderStatus(plan.next), alreadyApplied: true };

    const surface = BASKET_REMINDERS_SURFACES[input.surface];
    const consentEventId = eventIdFor(input.userId, input.idempotencyKey);
    const receipt = await this.consent.commitStateChange({
      ...key,
      consent_event_id: consentEventId,
      event_type: plan.eventType,
      state: plan.next,
      previous_state: current?.state ?? null,
      new_state: plan.next,
      identity_level: 'verified_account',
      source_surface: surface,
      actor_type: 'customer',
      actor_id: input.userId,
      copy_version_id: BASKET_REMINDERS_COPY_VERSION,
      reason: input.requested === 'granted'
        ? (input.surface === 'registration' ? 'customer ticked the basket reminders box when creating the account' : 'customer ticked the basket reminders box in the preference centre')
        : 'customer switched basket reminders off in the preference centre',
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
        purposeKey: BASKET_REMINDERS_PURPOSE,
        channelKey: BASKET_REMINDERS_CHANNEL,
        endpointHash: phone ? this.hasher.hash(phone) : null,
        endpointMasked: phone ? maskE164(phone) : null,
        copyVersionId: BASKET_REMINDERS_COPY_VERSION,
        copyTextHash: basketRemindersCopyHash(),
        confirmation: input.requested === 'granted' ? 'CHECKBOX_TICKED' : 'WITHDRAW_BUTTON',
        ipHash: hashOrNull(input.ipAddress?.trim() || null),
        userAgentHash: hashOrNull(input.userAgent?.trim().slice(0, 512) || null),
        sourceSurface: surface,
      });
    }
    return { ok: true, status: basketReminderStatus(receipt.state), alreadyApplied: receipt.already_applied };
  }

  /** The gate the reminder reads: a grant that covers today's number, and no STOP against it. */
  async mayRemind(userId: string): Promise<{ allowed: boolean; reason: string; phoneE164: string | null }> {
    const account = await this.accounts.findAccount(userId);
    const phone = normalisePhoneE164(account?.phone);
    const row = await this.consent.getLatestConsentState(keyFor(userId));
    const consentedPhoneHash = row?.state === 'granted' && row.last_consent_event_id
      ? (await this.evidence.latestFor(row.last_consent_event_id))?.endpointHash ?? null
      : null;
    const gate = mayReceiveBasketReminder({ state: row?.state ?? null, consentedPhoneHash, currentPhoneHash: phone ? this.hasher.hash(phone) : null });
    if (gate.allowed && this.consent.hasActiveChannelSuppression) {
      const refs = [keyFor(userId).endpoint_ref, ...(phone ? [`phone:${phone}`] : [])];
      if (await this.consent.hasActiveChannelSuppression(refs, BASKET_REMINDERS_CHANNEL, BASKET_REMINDERS_PURPOSE)) {
        return { allowed: false, reason: 'SUPPRESSED', phoneE164: null };
      }
    }
    return { ...gate, phoneE164: gate.allowed ? phone : null };
  }
}
