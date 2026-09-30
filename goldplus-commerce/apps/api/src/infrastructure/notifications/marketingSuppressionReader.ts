import type { ConsentOperatingRepository } from '../../application/ports/consent/ConsentOperatingRepository';
import { WHATSAPP_MARKETING_PURPOSE } from '../../domain/consent/WhatsAppMarketingConsent';
import type { MarketingSuppressionReader } from './OutboundGovernanceService';

const CHANNEL_KEY = { EMAIL: 'email', SMS: 'sms', WHATSAPP: 'whatsapp' } as const;

/**
 * The reader the shared outbound decision uses for MARKETING: is there an
 * active suppression for this contact on this channel?
 *
 * A channel-wide suppression (no purpose) matches any purpose. WhatsApp
 * marketing also has a purpose key of its own, so a suppression scoped to it
 * is checked as well. Push has no suppression record. A repository without the
 * lookup is an error, not "no suppression": the caller fails closed on a throw.
 */
export function buildMarketingSuppressionReader(
  consent: Pick<ConsentOperatingRepository, 'hasActiveChannelSuppression'>,
): MarketingSuppressionReader {
  return async (channel, endpointRef) => {
    if (channel === 'PUSH') return false;
    if (!consent.hasActiveChannelSuppression) throw new Error('suppression_lookup_unavailable');
    const key = CHANNEL_KEY[channel];
    if (await consent.hasActiveChannelSuppression([endpointRef], key, 'marketing_offers_campaigns')) return true;
    return channel === 'WHATSAPP'
      ? consent.hasActiveChannelSuppression([endpointRef], key, WHATSAPP_MARKETING_PURPOSE)
      : false;
  };
}
