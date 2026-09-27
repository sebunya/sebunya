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
