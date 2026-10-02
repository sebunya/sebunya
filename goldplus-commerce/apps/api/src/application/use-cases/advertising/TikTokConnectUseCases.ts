import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { TikTokOAuthGateway } from '../../ports/TikTokOAuth';

type Saved = { ok: true } | { ok: false; message: string };

/**
 * Completes TikTok's advertiser authorisation (2026-10-02). TikTok sends the
 * admin back to /admin/advertising/tiktok/callback with a one-time code; this
 * exchanges it and stores the resulting Marketing API token on the TikTok
 * audiences capability, encrypted, exactly as a pasted token is stored.
 *
 * The app secret is used for the one exchange and not kept. The token is
 * stored only when TikTok says it covers the advertiser account the admin
 * named: a code obtained by somebody else authorising the same app for THEIR
 * account does not name ours, and is refused.
 */
export class TikTokConnectUseCases {
  constructor(
    private readonly gateway: TikTokOAuthGateway,
    /** Saves the advertiser ID and the token on the TikTok audiences capability (validated, encrypted, audited there). */
    private readonly saveToken: (actorId: string | null, advertiserId: string, token: string) => Promise<Saved>,
    private readonly audit: CreateAuditLogUseCase,
  ) {}

  async connect(actorId: string | null, input: { appId?: unknown; appSecret?: unknown; authCode?: unknown; advertiserId?: unknown }): Promise<{ ok: true; advertiserId: string } | { ok: false; message: string }> {
    const appId = String(input.appId ?? '').trim();
    const appSecret = String(input.appSecret ?? '').trim();
    const authCode = String(input.authCode ?? '').trim();
    const advertiserId = String(input.advertiserId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(authCode)) return { ok: false, message: 'There is no authorisation code. Start from the app\'s authorisation link in TikTok API for Business, and approve it there.' };
    if (!/^\d{10,25}$/.test(appId)) return { ok: false, message: 'The App ID does not look right (TikTok API for Business > My Apps: the number under the app name).' };
    if (!/^[A-Za-z0-9]{20,100}$/.test(appSecret)) return { ok: false, message: 'The App secret does not look right (TikTok API for Business > My Apps > the app > Secret).' };
    if (!/^\d{8,25}$/.test(advertiserId)) return { ok: false, message: 'The Advertiser ID does not look right (TikTok Ads Manager: the account menu at the top right).' };

    const answer = await this.gateway.exchange(appId, appSecret, authCode)
      .catch((): { ok: false; message: string } => ({ ok: false, message: 'TikTok could not be reached. The code is still usable for a short while: try again.' }));
    if (!answer.ok) {
      await this.audit.execute({ actorId, action: 'AD_TIKTOK_CONNECT_FAILED', entity: 'ad_capability', entityId: 'tiktok:audiences', newState: { advertiserId, reason: answer.message.slice(0, 300) } } as never);
      return { ok: false, message: answer.message };
    }
    if (!answer.advertiserIds.includes(advertiserId)) {
      await this.audit.execute({ actorId, action: 'AD_TIKTOK_CONNECT_FAILED', entity: 'ad_capability', entityId: 'tiktok:audiences', newState: { advertiserId, reason: 'ADVERTISER_NOT_AUTHORISED', authorised: answer.advertiserIds.slice(0, 20) } } as never);
      return { ok: false, message: answer.advertiserIds.length
        ? `TikTok authorised the app for ${answer.advertiserIds.slice(0, 5).join(', ')}, not for advertiser ${advertiserId}. Nothing was saved. Authorise again and tick the right advertiser account.`
        : `TikTok authorised the app for no advertiser account. Nothing was saved. Authorise again and tick advertiser ${advertiserId}.` };
    }
    const saved = await this.saveToken(actorId, advertiserId, answer.accessToken);
    if (!saved.ok) return { ok: false, message: saved.message };
    await this.audit.execute({ actorId, action: 'AD_TIKTOK_CONNECTED', entity: 'ad_capability', entityId: 'tiktok:audiences', newState: { advertiserId, advertisersAuthorised: answer.advertiserIds.length } } as never);
    return { ok: true, advertiserId };
  }
}
