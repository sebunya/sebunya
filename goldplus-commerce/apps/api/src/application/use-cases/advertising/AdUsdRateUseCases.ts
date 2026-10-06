import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { MIN_UGX_PER_USD } from '../../../domain/advertising/AdMoney';

/** The one shillings-per-dollar rate every ad platform's amounts use (0172). Audited. */
export class AdUsdRateUseCases {
  constructor(
    private readonly store: { get: () => Promise<number | null>; set: (rate: number | null, actorId: string | null) => Promise<void> },
    private readonly audit: Pick<CreateAuditLogUseCase, 'execute'>,
  ) {}

  get() { return this.store.get(); }

  async set(actorId: string | null, input: unknown): Promise<{ ok: true; rate: number | null } | { ok: false; message: string }> {
    const raw = String(input ?? '').trim().replace(/[, _]/g, '');
    const rate = raw === '' ? null : Number(raw);
    if (rate !== null && (!Number.isInteger(rate) || rate < MIN_UGX_PER_USD || rate > 999_999)) {
      return { ok: false, message: 'Enter whole shillings per US dollar, for example 3700. Leave empty to send no amounts.' };
    }
    const before = await this.store.get();
    await this.store.set(rate, actorId);
    await this.audit.execute({ actorId, action: 'AD_USD_RATE_SET', entity: 'ad_settings', entityId: 'ugx_per_usd', oldState: { rate: before }, newState: { rate } } as never);
    return { ok: true, rate };
  }
}
