import type { OfflineConversionGateway, OfflineConversionRepository, OfflineConversionRow, PlatformCredentials } from '../../ports/Advertising';
import { OFFLINE_PLATFORMS, afterFailure, hasMatchKey, offlineSaleErrors, onlinePurchaseCoversSale, withinSendWindow, type OfflinePlatform, type OfflineSaleInput } from '../../../domain/advertising/OfflineConversionPolicy';
import { offlineSaleHashes } from '../../../domain/advertising/ContactNormalisation';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { CapabilityView } from './AdCapabilities';

type R<T> = { ok: true; value: T } | { ok: false; code: 'BAD_INPUT' | 'NOT_FOUND'; message: string };

/**
 * Offline conversions (docs/advertising/README.md, "Offline conversions").
 *
 * record: an admin enters a phone or WhatsApp sale. The contact is hashed at
 *   once (every platform's normalisation) and the plaintext is not stored; the
 *   accounts and browsers that belong to that contact are kept so consent is
 *   re-checked at send time.
 * enqueue: one PENDING row per LIVE platform for every COD delivery (the
 *   authoritative order_delivered event) and admin sale inside the window.
 *   Idempotent on (platform, source, source reference).
 * dispatch: for each due row — the online purchase already covers it
 *   (DUPLICATE_ONLINE), too old (EXPIRED), consent refused (SUPPRESSED), no
 *   identifier (SKIPPED), otherwise one request; retries with backoff, a
 *   permanent refusal is FAILED. Nothing is sent for a platform that is not LIVE.
 */
export class OfflineConversionUseCases {
  constructor(
    private readonly repo: OfflineConversionRepository,
    private readonly gateway: OfflineConversionGateway,
    private readonly capability: (platform: string) => Promise<CapabilityView | null>,
    private readonly credentials: (platform: string) => Promise<PlatformCredentials>,
    private readonly audit: CreateAuditLogUseCase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordSale(actorId: string | null, input: OfflineSaleInput): Promise<R<{ id: string }>> {
    const errors = offlineSaleErrors(input, this.now());
    if (errors.length) return { ok: false, code: 'BAD_INPUT', message: errors.join(' ') };
    let order: Awaited<ReturnType<OfflineConversionRepository['findOrder']>> = null;
    const orderNumber = String(input.orderNumber ?? '').trim();
    if (orderNumber) {
      order = await this.repo.findOrder(orderNumber);
      if (!order) return { ok: false, code: 'NOT_FOUND', message: `No order ${orderNumber} was found. Leave the order number blank for a sale that has no order.` };
    }
    const contact = { email: input.email ?? null, phone: input.phone ?? null };
    const found = await this.repo.consentSubjectsForContact(contact);
    const subjects = {
      userIds: [...new Set([...found.userIds, ...(order?.userId ? [order.userId] : []), ...(order?.linkedUserIds ?? [])])],
      fpClientIds: [...new Set([...found.fpClientIds, ...(order?.fpClientId ? [order.fpClientId] : []), ...(order?.linkedFpClientIds ?? [])])],
    };
    const id = await this.repo.recordSale({
      channel: input.channel as 'PHONE' | 'WHATSAPP', occurredAt: new Date(input.occurredAt), valueUgx: Number(input.valueUgx), orderId: order?.id ?? null,
      hashes: offlineSaleHashes(contact), subjects, note: String(input.note ?? '').trim() || null, recordedBy: actorId,
    });
    await this.audit.execute({ actorId, action: 'AD_OFFLINE_SALE_RECORDED', entity: 'ad_offline_sale', entityId: id,
      newState: { channel: input.channel, valueUgx: Number(input.valueUgx), orderNumber: orderNumber || null, hasEmail: !!contact.email, hasPhone: !!contact.phone } });
    return { ok: true, value: { id } };
  }

  /** The platforms whose offline capability is LIVE now. */
  private async livePlatforms(): Promise<OfflinePlatform[]> {
    const out: OfflinePlatform[] = [];
    for (const p of OFFLINE_PLATFORMS) if (await this.capability(p)) out.push(p);
    return out;
  }

  async enqueue(): Promise<number> {
    const live = await this.livePlatforms();
    if (live.length === 0) return 0;
    // The widest send window (Google's 90 days); each row is checked against its own platform's window.
    return this.repo.enqueue(live, 90);
  }

  async dispatch(limit = 25): Promise<{ sent: number; duplicate: number; suppressed: number; skipped: number; failed: number; retried: number; expired: number }> {
    const out = { sent: 0, duplicate: 0, suppressed: 0, skipped: 0, failed: 0, retried: 0, expired: 0 };
    const rows = await this.repo.due(limit);
    for (const row of rows) {
      const r = await this.dispatchOne(row);
      out[r]++;
    }
    return out;
  }

  private async dispatchOne(row: OfflineConversionRow): Promise<'sent' | 'duplicate' | 'suppressed' | 'skipped' | 'failed' | 'retried' | 'expired'> {
    const platform = row.platform as OfflinePlatform;
    if (!(await this.capability(platform))) { await this.repo.finish(row.id, 'SKIPPED', 'Not configured: offline conversions switched off before this was sent.'); return 'skipped'; }
    if (!withinSendWindow(platform, new Date(row.occurredAt), this.now())) { await this.repo.finish(row.id, 'EXPIRED', 'Older than the platform accepts.'); return 'expired'; }
    const ctx = await this.repo.context(row);
    if (!ctx) { await this.repo.finish(row.id, 'SKIPPED', 'The sale or order could not be read.'); return 'skipped'; }
    if (ctx.orderId) {
      const online = await this.repo.onlinePurchaseState(ctx.orderId, platform);
      if (onlinePurchaseCoversSale(online)) { await this.repo.finish(row.id, 'DUPLICATE_ONLINE', `The online purchase for this order is already ${String(online).toLowerCase()} for this platform.`); return 'duplicate'; }
    }
    let refused: boolean;
    try { refused = await this.repo.refused(ctx.subjects); } catch {
      await this.repo.finish(row.id, 'PENDING', 'CONSENT_LOOKUP_FAILED', { nextAttemptAt: new Date(this.now().getTime() + 5 * 60_000) });
      return 'retried';
    }
    if (refused) { await this.repo.finish(row.id, 'SUPPRESSED', 'CONSENT_DENIED'); return 'suppressed'; }
    if (!hasMatchKey(platform, ctx)) { await this.repo.finish(row.id, 'SKIPPED', 'No click id, email or phone this platform can match on.'); return 'skipped'; }
    const attempt = row.attemptCount + 1;
    let res: { status: number | null; error: string | null };
    try {
      res = await this.gateway.send(ctx, await this.credentials(platform));
    } catch (err) {
      res = { status: (err as { status?: number }).status ?? null, error: String((err as Error).message ?? err).slice(0, 250) };
    }
    if (res.status != null && res.status >= 200 && res.status < 300 && !res.error) {
      await this.repo.finish(row.id, 'SENT', null, { attempt, sent: true });
      return 'sent';
    }
    const next = afterFailure(attempt, res.status);
    await this.repo.finish(row.id, next.state, `${res.status ? `HTTP ${res.status}: ` : ''}${res.error ?? 'no reply'}`.slice(0, 300), { attempt, nextAttemptAt: new Date(this.now().getTime() + next.delayMs) });
    return next.state === 'FAILED' ? 'failed' : 'retried';
  }

  async overview() {
    const [sales, conversions, counts] = await Promise.all([this.repo.listSales(30), this.repo.list(50), this.repo.counts()]);
    return { sales, conversions, counts };
  }
}
