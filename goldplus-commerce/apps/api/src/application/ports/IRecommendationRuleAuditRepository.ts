export interface RuleAuditRecord {
  id?: string;
  ruleId?: string;
  action: string;
  before?: any;
  after?: any;
  performedBy?: string | null;
  performedAt?: Date;
  metadata?: Record<string, any>;
}

export interface IRecommendationRuleAuditRepository {
  record(event: RuleAuditRecord): Promise<void>;
  findByRuleId(ruleId: string): Promise<RuleAuditRecord[]>;
}
