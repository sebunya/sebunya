/**
 * Campaign scaffold governance (Wave 2F, no-send).
 *
 * This wave gives the orphaned campaigns/utm_links tables their first reader and
 * writer: definitions, UTM links and a consent-aware audience PREVIEW. There is
 * deliberately NO send path — no provider adapters are reachable from any state
 * this scaffold can produce. The status vocabulary therefore excludes every
 * sending state; ACTIVATING a campaign belongs to the send wave, behind the
 * no-send verification rules.
 */

export const CAMPAIGN_CHANNELS = ['email', 'sms', 'whatsapp', 'internal'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const CAMPAIGN_STATUSES = ['DRAFT', 'APPROVED', 'PAUSED', 'ARCHIVED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['APPROVED', 'ARCHIVED'],
  APPROVED: ['PAUSED', 'ARCHIVED'],
  PAUSED: ['APPROVED', 'ARCHIVED'],
  ARCHIVED: [],
};

export type CampaignStatusDecision =
  | { allowed: true }
  | { allowed: false; code: 'ILLEGAL_STATUS' | 'ILLEGAL_TRANSITION' | 'SEND_STATE_FORBIDDEN'; message: string };

export function canTransitionCampaign(from: string, to: string): CampaignStatusDecision {
  if (/^(ACTIVE|SENDING|LIVE|SCHEDULED_SEND)$/i.test(to)) {
    return {
      allowed: false,
      code: 'SEND_STATE_FORBIDDEN',
      message: 'Sending states are not reachable from the scaffold — campaign activation ships with the send wave under no-send verification.',
    };
  }
  if (!CAMPAIGN_STATUSES.includes(to as CampaignStatus)) {
    return { allowed: false, code: 'ILLEGAL_STATUS', message: `Unknown status '${to}'.` };
  }
  const fromStatus = CAMPAIGN_STATUSES.includes(from as CampaignStatus) ? (from as CampaignStatus) : 'DRAFT';
  if (!ALLOWED_TRANSITIONS[fromStatus].includes(to as CampaignStatus)) {
    return { allowed: false, code: 'ILLEGAL_TRANSITION', message: `Campaign cannot move ${fromStatus} → ${to}.` };
  }
  return { allowed: true };
}

export function validateUtm(input: { source?: unknown; medium?: unknown; campaignName?: unknown }):
  | { ok: true; source: string; medium: string; campaignName: string }
  | { ok: false; message: string } {
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : '');
  const source = clean(input.source);
  const medium = clean(input.medium);
  const campaignName = clean(input.campaignName);
  if (!source || !medium || !campaignName) {
    return { ok: false, message: 'source, medium and campaignName are required (a-z, 0-9, _ and - only).' };
  }
  return { ok: true, source, medium, campaignName };
}
