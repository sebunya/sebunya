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
  // Lower-cased, never rewritten: a value with other characters is refused, so
  // the stored record cannot silently differ from the link it describes.
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const source = clean(input.source);
  const medium = clean(input.medium);
  const campaignName = clean(input.campaignName);
  const valid = (v: string) => /^[a-z0-9_-]{1,100}$/.test(v);
  if (!valid(source) || !valid(medium) || !valid(campaignName)) {
    return { ok: false, message: 'source, medium and campaignName are required: letters, digits, _ and - only, at most 100 characters each.' };
  }
  return { ok: true, source, medium, campaignName };
}

/**
 * The key that makes a saved UTM link unique within its campaign (stored as
 * utm_links.short_url). It covers everything that makes two links different.
 * Term and destination are appended only when present, so a link saved
 * without them keeps the key it already has. A link saved WITH a term or a
 * destination before this key covered them holds the shorter key, so the same
 * link can be saved once more; that is the price of not rewriting stored keys.
 */
export function utmLinkDedupeKey(
  campaignId: string,
  utm: { source: string; medium: string; campaignName: string; content?: string | null; term?: string | null; destinationUrl?: string | null },
): string {
  const extra = `${utm.term ? `|t:${utm.term}` : ''}${utm.destinationUrl ? `|d:${utm.destinationUrl}` : ''}`;
  const text = `${campaignId}${utm.source}${utm.medium}${utm.campaignName}${utm.content ?? ''}${extra}`;
  return `gp-${Math.abs([...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36)}`;
}

/**
 * The optional landing page saved with a UTM link: an absolute http(s) URL of
 * at most 2,048 characters, stored without any utm_* parameters of its own
 * (the link's tags are stored separately). Empty means "none".
 */
export function normaliseUtmDestination(raw: unknown):
  | { ok: true; destinationUrl: string | null }
  | { ok: false; message: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: true, destinationUrl: null };
  const text = raw.trim();
  let parsed: URL | null = null;
  try { parsed = new URL(text); } catch { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol) || text.length > 2048) {
    return { ok: false, message: 'Destination must be a full http(s) link of at most 2,048 characters.' };
  }
  for (const k of [...parsed.searchParams.keys()]) if (k.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(k);
  return { ok: true, destinationUrl: parsed.toString() };
}
