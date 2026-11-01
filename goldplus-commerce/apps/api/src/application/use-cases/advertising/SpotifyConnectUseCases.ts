import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { SpotifyAdsGateway } from '../../ports/SpotifyAdsApi';

type Saved = { ok: true } | { ok: false; message: string };

/**
 * Completes "Connect Spotify" (2026-10-06). Spotify sends the admin back to
 * /admin/advertising/spotify/callback with a one-time code; the web page holds
 * the PKCE verifier. This exchanges the code (client ID + verifier, never a
 * client secret), then stores the refresh token ONLY if the new access token
 * can read the ad account the owner named: a code from somebody else's
 * Spotify login that cannot see our account is refused and nothing is saved.
 */
export class SpotifyConnectUseCases {
  constructor(
    private readonly gateway: SpotifyAdsGateway,
    private readonly loadConfig: () => Promise<{ clientId: string; adAccountId: string }>,
    /** Stores the refresh token on the spotify:ads_api capability (encrypted, audited there). */
    private readonly saveToken: (actorId: string | null, refreshToken: string) => Promise<Saved>,
    private readonly audit: Pick<CreateAuditLogUseCase, 'execute'>,
  ) {}

  async connect(actorId: string | null, input: { code?: unknown; codeVerifier?: unknown; redirectUri?: unknown }): Promise<{ ok: true; adAccountId: string; adAccountName: string | null } | { ok: false; message: string }> {
    const code = String(input.code ?? '').trim();
    const codeVerifier = String(input.codeVerifier ?? '').trim();
    const redirectUri = String(input.redirectUri ?? '').trim();
    if (!/^[A-Za-z0-9_-]{10,1000}$/.test(code)) return { ok: false, message: 'There is no sign-in code. Start again from Connect Spotify and approve the app in Spotify.' };
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) return { ok: false, message: 'The sign-in started in another browser or expired. Start again from Connect Spotify.' };
    if (!/^https:\/\/[^\s]+\/admin\/advertising\/spotify\/callback$/.test(redirectUri)) return { ok: false, message: 'The return address is not the registered one.' };
    const { clientId, adAccountId } = await this.loadConfig();
    if (!/^[0-9a-f]{32}$/.test(clientId)) return { ok: false, message: 'Save the Spotify app client ID first (Connect Spotify page).' };
    if (!/^[0-9a-f-]{36}$/i.test(adAccountId)) return { ok: false, message: 'Save the Goldplus ad account ID first (Connect Spotify page).' };

    const fail = async (reason: string, message: string) => {
      await this.audit.execute({ actorId, action: 'AD_SPOTIFY_CONNECT_FAILED', entity: 'ad_capability', entityId: 'spotify:ads_api', newState: { adAccountId, reason: reason.slice(0, 300) } } as never);
      return { ok: false as const, message };
    };
    const tokens = await this.gateway.exchangeCode({ clientId, code, codeVerifier, redirectUri })
      .catch(() => ({ ok: false as const, message: 'Spotify could not be reached. Start again from Connect Spotify.' }));
    if (!tokens.ok) return fail(tokens.message, tokens.message);
    const account = await this.gateway.readAdAccount(tokens.accessToken, adAccountId)
      .catch(() => ({ ok: false as const, message: 'Spotify could not be reached to check the ad account. Nothing was saved.' }));
    if (!account.ok) return fail(account.message, `${account.message} Nothing was saved. Sign in to Spotify as a member of the Goldplus ad account, or check the ad account ID.`);
    const saved = await this.saveToken(actorId, tokens.refreshToken);
    if (!saved.ok) return fail(saved.message, saved.message);
    await this.audit.execute({ actorId, action: 'AD_SPOTIFY_CONNECTED', entity: 'ad_capability', entityId: 'spotify:ads_api', newState: { adAccountId, adAccountName: account.name } } as never);
    return { ok: true, adAccountId, adAccountName: account.name };
  }
}
