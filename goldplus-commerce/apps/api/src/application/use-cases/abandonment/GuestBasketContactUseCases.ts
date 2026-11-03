import { normalisePhoneE164 } from '../../../domain/customer-dna/IdentityStitching';
import { maskE164 } from '../../../domain/consent/WhatsAppMarketingConsent';
import { BASKET_REMINDERS_CHANNEL, BASKET_REMINDERS_PURPOSE } from '../../../domain/consent/BasketReminderConsent';
import type { ConsentOperatingRepository } from '../../ports/consent/ConsentOperatingRepository';

/** 0214: the phone a guest typed at checkout, against the guest cart owner id. */
export interface IGuestBasketContactRepository {
  upsert(input: { ownerId: string; phoneE164: string; name: string | null; now: Date }): Promise<void>;
}

export interface IBasketStopTokens {
  issue(phoneE164: string): string;
  read(token: string): string | null;
}

/**
 * Basket reminders for guests (owner decision 2026-11-03). A guest's number is known only once they type it at
 * checkout; it is kept against their cart owner id so a basket left behind gets the one text a signed-in customer
 * gets. The text carries a signed stop link: one tap records a STOP against the number (a channel suppression for
 * the basket_reminders purpose), which outranks everything else, for good, with no account needed.
 */
export class GuestBasketContactUseCases {
  constructor(
    private readonly contacts: IGuestBasketContactRepository,
    private readonly consent: ConsentOperatingRepository,
    private readonly tokens: IBasketStopTokens,
  ) {}

  /** Records (or replaces) the number for a guest basket. A number that is not Ugandan mobile shape is ignored, not refused. */
  async record(input: { ownerId: string; phone: string; name?: string | null }): Promise<{ recorded: boolean }> {
    const phone = normalisePhoneE164(input.phone);
    if (!phone || !input.ownerId) return { recorded: false };
    await this.contacts.upsert({ ownerId: input.ownerId, phoneE164: phone, name: input.name?.trim().slice(0, 120) || null, now: new Date() });
    return { recorded: true };
  }

  /** The gate the sweep and the router read for a guest: nothing but a STOP against the number refuses it. */
  async mayRemindGuest(phoneE164: string): Promise<{ allowed: boolean; reason: string }> {
    if (!this.consent.hasActiveChannelSuppression) return { allowed: true, reason: 'ON_BY_DEFAULT' };
    const stopped = await this.consent.hasActiveChannelSuppression([`phone:${phoneE164}`], BASKET_REMINDERS_CHANNEL, BASKET_REMINDERS_PURPOSE);
    return stopped ? { allowed: false, reason: 'SUPPRESSED' } : { allowed: true, reason: 'ON_BY_DEFAULT' };
  }

  stopUrlFor(phoneE164: string, publicBase: string): string {
    return `${publicBase}/stop-texts?t=${encodeURIComponent(this.tokens.issue(phoneE164))}`;
  }

  /** What the stop page shows before the button: the masked number, or null for a token that is not ours. */
  describeStopToken(token: string): { phoneMasked: string } | null {
    const phone = this.tokens.read(token);
    return phone ? { phoneMasked: maskE164(phone) } : null;
  }

  /** One tap on the stop page: a STOP against the number. Idempotent per number. */
  async stop(input: { token: string; correlationId: string }): Promise<{ ok: true; phoneMasked: string } | { ok: false; code: 'BAD_TOKEN' }> {
    const phone = this.tokens.read(input.token);
    if (!phone) return { ok: false, code: 'BAD_TOKEN' };
    await this.consent.recordChannelSuppression({
      customer_identity_ref: null,
      endpoint_ref: `phone:${phone}`,
      channel_key: BASKET_REMINDERS_CHANNEL,
      purpose_key: BASKET_REMINDERS_PURPOSE,
      scope: 'purpose',
      reason: 'customer tapped the stop link in a basket reminder text',
      source_surface: 'basket_reminder_stop_link',
      provider_callback_ref: null,
      correlation_id: input.correlationId,
      // Dated: a suppression later lifted by staff must not make the next tap throw (the repository refuses a re-send of a lifted key).
      idempotency_key: `basket-stop:${phone}:${new Date().toISOString().slice(0, 10)}`,
      effective_at: new Date().toISOString(),
    });
    return { ok: true, phoneMasked: maskE164(phone) };
  }
}
