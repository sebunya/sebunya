import { randomUUID } from 'node:crypto';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { TikTokDiagnosticsGateway } from '../../ports/TikTokDiagnostics';

export interface TikTokDestination { config: Record<string, string>; token: string }

export const isTikTokTestEventCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{4,40}$/.test(v.trim());

/**
 * The owner's check that TikTok accepts what the shop sends (2026-10-01): one
 * test event, shaped by the same builder as a real one, with the test event
 * code from Events Manager. It describes no real visitor and is audited.
 */
export class TikTokDiagnosticsUseCases {
  constructor(
    private readonly gateway: TikTokDiagnosticsGateway,
    /** THROWS a readable "Not configured: …" message when there is nothing to send with. */
    private readonly destination: () => Promise<TikTokDestination>,
    private readonly audit: CreateAuditLogUseCase,
    private readonly siteOrigin: () => string | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async sendTestEvent(actorId: string | null, testEventCode: unknown, kind: unknown = 'view'): Promise<
    { ok: true; eventId: string; eventName: string; requestId: string | null; sentValue: { value: number; currency: string } | null } | { ok: false; message: string }> {
    if (!isTikTokTestEventCode(testEventCode)) return { ok: false, message: 'Enter the test event code from TikTok Events Manager > your pixel > Test events.' };
    let dest: TikTokDestination;
    try { dest = await this.destination(); } catch (err) { return { ok: false, message: (err as Error).message }; }
    const origin = this.siteOrigin();
    if (!origin) return { ok: false, message: 'The storefront address is not set on the server (PUBLIC_SITE_ORIGIN), and TikTok requires the page a web event came from.' };
    const eventId = `goldplus-connection-test-${randomUUID()}`;
    const purchase = kind === 'purchase';
    const answer = await this.gateway.sendTestEvent({ config: dest.config, token: dest.token, testEventCode: testEventCode.trim(), kind: purchase ? 'purchase' : 'view', origin, eventId, eventTime: Math.floor(this.now() / 1000) })
      .catch((e) => ({ ok: false as const, message: `TikTok could not be reached: ${(e as Error).message}`, credentials: false, transient: true }));
    const eventName = purchase ? 'Purchase' : 'ViewContent';
    await this.audit.execute({ actorId, action: 'AD_TEST_EVENT_SENT', entity: 'ad_destination', entityId: 'tiktok',
      newState: { pixelCode: dest.config.pixelCode, eventId, eventName, accepted: answer.ok, ...(answer.ok ? { requestId: answer.requestId } : { refusal: answer.message.slice(0, 300) }) } } as never);
    if (!answer.ok) return { ok: false, message: answer.message };
    return { ok: true, eventId, eventName, requestId: answer.requestId, sentValue: answer.sentValue };
  }
}
