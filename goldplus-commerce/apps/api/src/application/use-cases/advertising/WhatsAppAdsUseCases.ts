import type { WhatsAppAdReferralRepository } from '../../ports/WhatsAppAds';
import {
  CTWA_WINDOW_DEFAULT_DAYS, messagingClickWins, parseAdReferrals, subscriptionChallenge, verifyWebhookSignature, type CtwaSecrets,
} from '../../../domain/advertising/WhatsAppAdReferrals';

/** The WhatsApp ads settings as saved (the secrets are read just in time and go no further than this class). */
export interface CtwaSettings {
  /** Switched on, with everything it needs. */
  live: boolean;
  wabaId: string;
  windowDays: number;
  /** The dataset linked to the WhatsApp Business Account; null = the web conversions dataset. */
  datasetId: string | null;
  secrets: CtwaSecrets;
}

/** What a sale needs to be reported against a WhatsApp advert. */
export interface CtwaAttribution { referralId: string; ctwaClid: string; wabaId: string; datasetId: string | null; accessToken: string | null }

const MAX_BODY_BYTES = 1_000_000;
/**
 * How long a referral is kept. The longest window a sale can be credited in
 * is 28 days; 90 leaves room to look into "why was this not credited" and no
 * more. After that the hash and the click id are deleted.
 */
export const CTWA_RETENTION_DAYS = 90;
const PURGE_EVERY_MS = 60 * 60_000;

/**
 * Click-to-WhatsApp advert attribution (2026-10-01).
 *
 * Receives the WhatsApp Business Platform's webhook, keeps the advert click
 * id of each chat that began from an advert, and hands it to the two places a
 * sale is reported to Meta (an order placed on the site, a WhatsApp sale an
 * admin records) so that sale is credited to the advert.
 *
 * Nothing is accepted that Meta did not sign, nothing is stored while the
 * capability is off, and nothing is stored about the message but its id and
 * time.
 */
export class WhatsAppAdsUseCases {
  constructor(
    private readonly repo: WhatsAppAdReferralRepository,
    /** null when the capability has never been saved, or its secrets cannot be read. */
    private readonly settings: () => Promise<CtwaSettings | null>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private lastPurgeAt = 0;
  /** At most hourly, and never in the way of a delivery: old referrals are removed. */
  private async purgeIfDue(): Promise<void> {
    const t = this.now().getTime();
    if (t - this.lastPurgeAt < PURGE_EVERY_MS) return;
    this.lastPurgeAt = t;
    await this.repo.purgeBefore(new Date(t - CTWA_RETENTION_DAYS * 86_400_000)).catch(() => undefined);
  }

  /** Meta's subscription check (GET). The challenge to echo, or null to refuse. Works before the capability is switched on: verification is part of setting it up. */
  async verifySubscription(query: { mode?: string | null; token?: string | null; challenge?: string | null }): Promise<string | null> {
    const s = await this.settings().catch(() => null);
    return s ? subscriptionChallenge(query, s.secrets.verifyToken) : null;
  }

  /**
   * One webhook delivery (POST). The status is what Meta is answered with:
   * 200 once the signature holds (whatever was in it, so Meta does not retry
   * what we chose to ignore), 401 when it does not, 404 when nothing is
   * configured to receive it.
   */
  async receive(rawBody: string, signatureHeader: string | null | undefined): Promise<{ status: 200 | 401 | 404 | 413; stored: number; duplicates: number; messages: number; withoutClickId: number }> {
    const none = { stored: 0, duplicates: 0, messages: 0, withoutClickId: 0 };
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return { status: 413, ...none };
    const s = await this.settings().catch(() => null);
    if (!s) return { status: 404, ...none };
    // Before anything is parsed: the signature is over the bytes as received.
    if (!verifyWebhookSignature(rawBody, signatureHeader, s.secrets.appSecret)) return { status: 401, ...none };
    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { return { status: 200, ...none }; }
    const parsed = parseAdReferrals(payload, s.wabaId, this.now());
    // Signed and understood, but switched off: acknowledged and not kept.
    if (!s.live) return { status: 200, stored: 0, duplicates: 0, messages: parsed.messages, withoutClickId: parsed.referralsWithoutClickId };
    let stored = 0, duplicates = 0;
    for (const r of parsed.referrals) {
      if (await this.repo.record(r)) stored += 1;
      else duplicates += 1;
    }
    await this.purgeIfDue();
    return { status: 200, stored, duplicates, messages: parsed.messages, withoutClickId: parsed.referralsWithoutClickId };
  }

  /**
   * The advert a sale by this buyer should be credited to, or null. `fbc` is
   * the buyer's Meta web click, when the sale has one: the later click wins,
   * so one sale is never reported against two adverts.
   */
  async attributionFor(senderPhoneSha256: string | null | undefined, saleAt: Date, fbc?: unknown): Promise<CtwaAttribution | null> {
    if (!senderPhoneSha256 || !/^[0-9a-f]{64}$/.test(senderPhoneSha256)) return null;
    const s = await this.settings().catch(() => null);
    if (!s?.live) return null;
    const from = new Date(saleAt.getTime() - s.windowDays * 86_400_000);
    const ref = await this.repo.latestFor(senderPhoneSha256, from, saleAt);
    if (!ref || !messagingClickWins(fbc, ref.receivedAt)) return null;
    return { referralId: ref.id, ctwaClid: ref.ctwaClid, wabaId: ref.wabaId, datasetId: s.datasetId, accessToken: s.secrets.accessToken };
  }

  markAttributed(referralId: string): Promise<void> { return this.repo.markAttributed(referralId); }

  /** For the admin page: what is set up and what has arrived. No secret, no click id. */
  async overview(webhookUrl: string) {
    const s = await this.settings().catch(() => null);
    const since = new Date(this.now().getTime() - 30 * 86_400_000);
    const stats = await this.repo.stats(since);
    return {
      configured: !!s, live: !!s?.live, wabaId: s?.wabaId ?? null, windowDays: s?.windowDays ?? CTWA_WINDOW_DEFAULT_DAYS,
      ownDataset: !!s?.datasetId, ownToken: !!s?.secrets.accessToken, retentionDays: CTWA_RETENTION_DAYS,
      webhookUrl, last30Days: stats,
    };
  }
}
