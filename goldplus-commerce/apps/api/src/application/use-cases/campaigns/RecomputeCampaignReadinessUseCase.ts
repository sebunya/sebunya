import { CampaignReadinessScorer, type CampaignReadiness } from '../../../domain/advertising/CampaignReadinessScorer';

/** Port: the slice of the campaign repository the readiness recompute needs. */
export interface CampaignReadinessRepositoryPort {
  findById(id: string): Promise<{ id: string; name: string; objective: string; channel: string; targetUrl: string | null } | null>;
  countUtmLinks(campaignId: string): Promise<number>;
  setReadinessScore(id: string, score: number): Promise<unknown>;
}

/**
 * Recomputes and stores campaigns.readiness_score. Called after a campaign is
 * created and after a UTM link is added (the only campaign edits that change
 * readiness inputs; status changes do not).
 */
export class RecomputeCampaignReadinessUseCase {
  constructor(
    private readonly repo: CampaignReadinessRepositoryPort,
    private readonly scorer = new CampaignReadinessScorer(),
  ) {}

  async execute(campaignId: string): Promise<CampaignReadiness | null> {
    const campaign = await this.repo.findById(campaignId);
    if (!campaign) return null;
    const utmLinkCount = await this.repo.countUtmLinks(campaignId);
    const result = this.scorer.score({ ...campaign, utmLinkCount });
    await this.repo.setReadinessScore(campaignId, result.score);
    return result;
  }
}

/** Port: listing campaigns with their currently stored score. */
export interface CampaignReadinessListPort extends CampaignReadinessRepositoryPort {
  list(): Promise<Array<{ id: string; readinessScore: number | null }>>;
}

/**
 * Backfill: campaigns created before the scorer was wired kept readiness 0.
 * Recomputes every campaign through RecomputeCampaignReadinessUseCase and
 * reports how many stored scores changed. Idempotent: a second run changes 0.
 */
export class RecomputeAllCampaignReadinessUseCase {
  private readonly single: RecomputeCampaignReadinessUseCase;
  constructor(private readonly repo: CampaignReadinessListPort) {
    this.single = new RecomputeCampaignReadinessUseCase(repo);
  }

  async execute(): Promise<{ total: number; changed: number }> {
    const rows = await this.repo.list();
    let changed = 0;
    for (const row of rows) {
      const result = await this.single.execute(row.id);
      if (result && result.score !== Number(row.readinessScore ?? 0)) changed++;
    }
    return { total: rows.length, changed };
  }
}
