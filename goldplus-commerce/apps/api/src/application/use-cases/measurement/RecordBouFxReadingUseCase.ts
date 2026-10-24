import type { FxReadingPort } from '../../ports/measurement/FxReadingPort';

export interface BouFxInput { day: string; mid: number; buying?: number | null; selling?: number | null; source?: string }
export type BouFxResult = { ok: true; day: string; mid: number } | { ok: false; message: string };

/**
 * One Bank of Uganda reading a day (2026-10-24): the mid rate the banks and URA work from, read off bou.or.ug by
 * the 1 pm job and posted here. Refused unless it is a plausible shilling rate for a real day, so a broken
 * scrape can never pin tonight's costs to nonsense.
 */
export class RecordBouFxReadingUseCase {
  constructor(private readonly store: FxReadingPort) {}

  async execute(input: BouFxInput): Promise<BouFxResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || Number.isNaN(Date.parse(`${input.day}T00:00:00Z`))) return { ok: false, message: 'day must be YYYY-MM-DD' };
    const ageDays = (Date.now() - Date.parse(`${input.day}T00:00:00Z`)) / 86_400_000;
    if (ageDays < -1 || ageDays > 10) return { ok: false, message: `day ${input.day} is not within the last ten days` };
    const mid = Number(input.mid);
    if (!Number.isFinite(mid) || mid < 1000 || mid > 20000) return { ok: false, message: `mid ${String(input.mid)} is not a plausible shillings-per-dollar rate` };
    const side = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
    const buying = side(input.buying), selling = side(input.selling);
    if (buying !== null && selling !== null && (buying > mid + 1 || selling < mid - 1)) return { ok: false, message: 'buying must not exceed mid and selling must not be below it' };
    const src = String(input.source ?? 'bou.or.ug').slice(0, 60);
    const note = `Bank of Uganda mid rate from ${src}${buying !== null ? `; buying ${buying}` : ''}${selling !== null ? `; selling ${selling}` : ''}`;
    await this.store.recordBou({ day: input.day, mid: Math.round(mid * 100) / 100, buying, selling, note });
    return { ok: true, day: input.day, mid };
  }
}
