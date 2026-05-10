export type CampaignStatus = 'draft' | 'active' | 'completed' | 'paused';

export class Campaign {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly objective: string,
    public readonly status: CampaignStatus,
    public readonly startDate: Date,
    public readonly endDate: Date | null,
    public readonly targetProductIds: string[] = [],
    public readonly budgetLimit: number | null = null,
    public readonly createdAt: Date = new Date()
  ) {}

  public isRunning(): boolean {
    const now = new Date();
    if (this.status !== 'active') return false;
    if (this.startDate > now) return false;
    if (this.endDate && this.endDate < now) return false;
    return true;
  }
}
