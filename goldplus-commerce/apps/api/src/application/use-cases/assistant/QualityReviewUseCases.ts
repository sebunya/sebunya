/**
 * The weekly human quality review: a sample of Goldie's chats, scored by a person (1-5, accurate?, tone right?,
 * a note). The sample leans to the chats most worth a look: the ones that needed a person, were rated poorly, or
 * went to the model; the rest is random. A week's sample is drawn once and kept.
 */
export interface QaRow { id: string; conversationId: string; week: string; score: number | null; accurate: boolean | null; toneOk: boolean | null; note: string | null; reviewedAt: Date | null; channel: string; outcome: string; csat: number | null; firstLine: string; lastMessageAt: Date }

export interface IQualityReviewRepository {
  sample(week: string, from: Date, to: Date, size: number): Promise<number>;
  list(week: string): Promise<QaRow[]>;
  review(id: string, input: { score: number; accurate: boolean; toneOk: boolean; note: string | null; reviewerId: string }): Promise<boolean>;
  trend(weeks: number): Promise<Array<{ week: string; reviewed: number; averageScore: number | null; accurateShare: number | null; toneShare: number | null }>>;
}

/** ISO week label in Kampala time, e.g. 2026-W42. */
export function isoWeek(d: Date): string {
  const k = new Date(d.getTime() + 3 * 3600_000);
  const t = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export class QualityReviewUseCases {
  constructor(private readonly repo: IQualityReviewRepository, private readonly now: () => Date = () => new Date(), private readonly sampleSize = 12) {}

  /** This week's sample (drawn on first look) from the last seven days. */
  async thisWeek(): Promise<{ week: string; items: QaRow[] }> {
    const now = this.now();
    const week = isoWeek(now);
    let items = await this.repo.list(week);
    if (!items.length) {
      await this.repo.sample(week, new Date(now.getTime() - 7 * 86400_000), now, this.sampleSize);
      items = await this.repo.list(week);
    }
    return { week, items };
  }

  async review(id: string, input: { score: number; accurate: boolean; toneOk: boolean; note?: string | null; reviewerId: string }) {
    if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) return false;
    return this.repo.review(id, { ...input, note: (input.note ?? '').trim().slice(0, 1000) || null });
  }

  trend(weeks = 8) { return this.repo.trend(weeks); }
}
