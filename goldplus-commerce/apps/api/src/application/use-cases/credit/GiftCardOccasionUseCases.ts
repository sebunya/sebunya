import { checkOccasionSettings, kampalaDay, orderOccasions, type OccasionOrder, type OccasionSettings } from '../../../domain/credit/GiftCardOccasions';

/** 0200: where the owner's occasion adjustments live (one row). */
export interface IOccasionSettingsRepository {
  read(): Promise<unknown>;
  write(settings: OccasionSettings, actorId: string): Promise<void>;
}

/**
 * Which gift card occasions come first today (GiftCardOccasions.ts), from the calendar and the owner's time-boxed
 * adjustments. Read when the buy page is opened (not baked into a build), so a window that starts or ends, or an
 * adjustment that expires, takes effect without a deploy. Cached 30 seconds per replica.
 */
export class GiftCardOccasionUseCases {
  private cache: { at: number; settings: OccasionSettings } | null = null;
  constructor(private readonly repo: IOccasionSettingsRepository) {}

  async settings(): Promise<OccasionSettings> {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.settings;
    const checked = checkOccasionSettings(await this.repo.read().catch(() => ({})));
    // Settings that no longer pass (should not happen: they are checked on save) promote nothing extra.
    const settings = checked.ok ? checked.value : {};
    this.cache = { at: Date.now(), settings };
    return settings;
  }

  /** `on`: a Kampala day to preview (admin), instead of today. */
  async orderFor(now = new Date(), on?: string | null): Promise<OccasionOrder & { today: string }> {
    const today = on && /^\d{4}-\d{2}-\d{2}$/.test(on) && !Number.isNaN(Date.parse(`${on}T00:00:00Z`)) ? on : kampalaDay(now);
    return { today, ...orderOccasions(today, await this.settings()) };
  }

  async save(input: unknown, actorId: string): Promise<{ ok: true; value: OccasionSettings } | { ok: false; message: string }> {
    const checked = checkOccasionSettings(input);
    if (!checked.ok) return checked;
    await this.repo.write(checked.value, actorId);
    this.cache = null;
    return checked;
  }
}
