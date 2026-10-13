import { MEMORY_TTL_DAYS, memoryUsable, rememberable, type RememberedProduct } from '../../../domain/assistant/AnswerMemory';

export interface AnswerMemoryRow {
  id: string; questionKey: string; question: string; answer: string; intent: string | null; products: RememberedProduct[];
  pinned: boolean; edited: boolean; retired: boolean; asks: number; served: number; poorRatings: number; staleMisses: number;
  expiresAt: Date | null; lastServedAt: Date | null; createdAt: Date; updatedAt: Date;
}

export interface IAnswerMemoryRepository {
  byKey(key: string): Promise<AnswerMemoryRow | null>;
  /** Insert, or refresh an unpinned, unedited entry with the newer answer (asks + 1). */
  remember(input: { key: string; question: string; answer: string; intent: string | null; products: RememberedProduct[]; expiresAt: Date }): Promise<void>;
  countAsk(id: string): Promise<void>;
  served(id: string): Promise<void>;
  stale(id: string): Promise<void>;
  poorRating(ids: string[]): Promise<void>;
  list(f: { limit: number; includeRetired: boolean }): Promise<AnswerMemoryRow[]>;
  update(id: string, patch: { answer?: string; pinned?: boolean; retired?: boolean }): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** How each Goldie answer was produced over a period, and what the paid ones cost. */
  routeMix(since: Date): Promise<{ byRoute: Record<string, number>; aiCostMicroUsd: number; aiCalls: number }>;
}

/**
 * The answer memory: look up before paying, remember after paying, learn from
 * ratings, and let the team pin, edit or retire answers. The caller checks the
 * live prices and stock of the remembered products before serving.
 */
export class AnswerMemoryUseCases {
  constructor(private readonly repo: IAnswerMemoryRepository, private readonly now: () => Date = () => new Date()) {}

  async lookup(key: string): Promise<{ id: string; answer: string; products: RememberedProduct[] } | null> {
    if (!/^[0-9a-f]{64}$/.test(key)) return null;
    const e = await this.repo.byKey(key);
    if (!e) return null;
    await this.repo.countAsk(e.id);
    if (!memoryUsable(e, this.now())) return null;
    return { id: e.id, answer: e.answer, products: e.products };
  }

  async remember(input: { key: string; question: string; answer: string; intent: string | null; products: RememberedProduct[] }): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(input.key) || !rememberable(input.answer)) return false;
    await this.repo.remember({ ...input, question: input.question.slice(0, 500), answer: input.answer.trim(), products: input.products.slice(0, 5), expiresAt: new Date(this.now().getTime() + MEMORY_TTL_DAYS * 86400_000) });
    return true;
  }

  served(id: string) { return this.repo.served(id); }
  stale(id: string) { return this.repo.stale(id); }
  poorRating(ids: string[]) { return ids.length ? this.repo.poorRating(ids) : Promise.resolve(); }
  list(includeRetired = false) { return this.repo.list({ limit: 200, includeRetired }); }
  async edit(id: string, patch: { answer?: string; pinned?: boolean; retired?: boolean }) {
    if (patch.answer !== undefined && (patch.answer.trim().length < 10 || patch.answer.length > 1500)) return false;
    return this.repo.update(id, patch);
  }
  remove(id: string) { return this.repo.remove(id); }

  /** The share of answers that cost nothing, and what the memory saved, for the meeting and the settings page. */
  async savings(days = 7) {
    const mix = await this.repo.routeMix(new Date(this.now().getTime() - days * 86400_000));
    const total = Object.values(mix.byRoute).reduce((s, n) => s + n, 0);
    const avgAi = mix.aiCalls ? mix.aiCostMicroUsd / mix.aiCalls : 0;
    const free = total - (mix.byRoute.ai ?? 0);
    return {
      days, answers: total, byRoute: mix.byRoute,
      freeShare: total ? free / total : null,
      modelSpendMicroUsd: mix.aiCostMicroUsd,
      averageModelAnswerMicroUsd: Math.round(avgAi),
      savedByMemoryMicroUsd: Math.round((mix.byRoute.cache ?? 0) * avgAi),
    };
  }
}
