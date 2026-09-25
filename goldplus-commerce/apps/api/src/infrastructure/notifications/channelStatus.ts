import { OutboundChannel, failsReleaseReadiness } from '../../domain/notifications/OutboundGovernancePolicy';
import { outboundGovernance } from './OutboundGovernanceService';
import { readZohoWhatsAppConfig, zohoTemplateKeyFor } from '../../config/zohoWhatsApp';
import { ZOHO_WHATSAPP_TEMPLATES } from './whatsapp/zohoWhatsAppTemplates';

/**
 * What the admin shows for each customer channel, derived from the SAME flags
 * and the SAME governance policy the adapters obey — never hand-written.
 * Presence of credentials only; no value is ever read into the result.
 */
export type ChannelState = 'NOT_CONFIGURED' | 'CONFIGURED_OFF' | 'CONFIGURED_DRY_RUN' | 'LIVE' | 'UNSAFE';

export interface ChannelStatus {
  channel: 'email' | 'sms' | 'whatsapp';
  provider: string;
  state: ChannelState;
  /** The flag or guard that decided the state. */
  guard: string;
  /** WhatsApp only: our templates that have a Zoho template key set. */
  keyedTemplates?: string[];
  /** WhatsApp only: our templates that have a WhatsApp mapping at all. */
  mappedTemplates?: string[];
}

const present = (env: NodeJS.ProcessEnv, ...keys: string[]) => keys.every((k) => (env[k] || '').trim() !== '');

function stateOf(channel: OutboundChannel, configured: boolean, env: NodeJS.ProcessEnv): { state: ChannelState; guard: string } {
  if (!configured) return { state: 'NOT_CONFIGURED', guard: 'PROVIDER_CREDENTIALS' };
  const v = outboundGovernance.configurationVerdict(channel, true, env);
  if (failsReleaseReadiness(v)) return { state: 'UNSAFE', guard: v.guard };
  if (v.kind === 'ALLOW_LIVE') return { state: 'LIVE', guard: v.guard };
  if (v.kind === 'ALLOW_DRY_RUN') return { state: 'CONFIGURED_DRY_RUN', guard: v.guard };
  return { state: 'CONFIGURED_OFF', guard: v.guard };
}

export function customerChannelStatuses(env: NodeJS.ProcessEnv = process.env): ChannelStatus[] {
  const emailConfigured = present(env, 'ZEPTOMAIL_API_TOKEN', 'ZEPTOMAIL_FROM_ADDRESS');
  const smsConfigured = (env.SMS_PROVIDER || '').trim() === 'pahappa_comms' && present(env, 'SMS_USERNAME', 'SMS_API_KEY', 'SMS_SENDER_ID');
  const wa = readZohoWhatsAppConfig(env);
  const mapped = Object.keys(ZOHO_WHATSAPP_TEMPLATES);
  return [
    { channel: 'email', provider: 'Zoho ZeptoMail', ...stateOf('EMAIL', emailConfigured, env) },
    { channel: 'sms', provider: 'EgoSMS (Pahappa)', ...stateOf('SMS', smsConfigured, env) },
    {
      channel: 'whatsapp',
      provider: 'Zoho CPaaS WhatsApp',
      ...stateOf('WHATSAPP', wa.configured, env),
      mappedTemplates: mapped,
      keyedTemplates: mapped.filter((t) => zohoTemplateKeyFor(t, env)),
    },
  ];
}
