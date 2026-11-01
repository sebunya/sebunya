import { buildNbaContextFromProfile, buildProfileDrivenCandidates, decideNextBestAction } from '../../../domain/customer-dna/NextBestAction';
import { numericFeature } from '../../../domain/customer-dna/CustomerFeatures';
import type { ICustomerFeatureRepository, ICustomerLifecycleRepository, ICustomerProfileRepository } from '../../ports/ICustomerDnaRepository';
import type { INbaContextReader } from '../../ports/first-party/FirstPartyPorts';
import type { GenerateNextBestActionUseCase, ProjectCustomerProfileUseCase } from '../customer-dna/CustomerDnaUseCases';

type Fail = { ok: false; code: string; message: string };

/**
 * Next-best action from the customer's REAL profile (0157). Replaces the admin
 * route that built its context from placeholders (no support case, no
 * frequency cap, no recent purchases, consent always unknown):
 *   - features come from a fresh projection when none exists yet;
 *   - consent per channel, open support tickets, open fraud cases, recent
 *     purchases, out-of-stock products and messages sent are READ
 *     (INbaContextReader);
 *   - anything unreadable fails closed (NextBestAction.buildNbaContextFromProfile).
 * The decision is recorded and audited by GenerateNextBestActionUseCase.
 */
export class DecideNextBestActionUseCase {
  constructor(
    private readonly profiles: ICustomerProfileRepository,
    private readonly features: ICustomerFeatureRepository,
    private readonly lifecycles: ICustomerLifecycleRepository,
    private readonly project: Pick<ProjectCustomerProfileUseCase, 'execute'>,
    private readonly context: INbaContextReader,
    private readonly generate: Pick<GenerateNextBestActionUseCase, 'execute'>,
  ) {}

  async execute(input: { canonicalCustomerId: string; actorId: string; activationChannel?: string | null }):
    Promise<{ ok: true; selectedAction: string; created: boolean; decisionId: string; reasonCodes: string[]; excluded: Array<{ actionType: string; reason: string | null }> } | Fail> {
    const profile = await this.profiles.findByCanonicalId(input.canonicalCustomerId);
    if (!profile) return { ok: false, code: 'NOT_FOUND', message: 'Customer profile not found.' };

    let feats = await this.features.latest(input.canonicalCustomerId);
    if (!feats) {
      const projected = await this.project.execute({ canonicalCustomerId: input.canonicalCustomerId, actorId: input.actorId });
      if (!projected.ok) return projected;
      feats = await this.features.latest(input.canonicalCustomerId);
    }
    const f = feats?.features ?? [];
    const lifecycle = await this.lifecycles.latest(input.canonicalCustomerId);
    const facts = await this.context.read({ canonicalCustomerId: input.canonicalCustomerId, accountUserId: profile.accountUserId });

    const candidates = buildProfileDrivenCandidates({
      lifecycleStage: lifecycle?.stage ?? profile.primaryLifecycleStage,
      cartAbandonments: numericFeature(f, 'cart_abandonments') ?? 0,
      backorderExposure: numericFeature(f, 'backorder_exposure') ?? 0,
      riskFlags: profile.riskFlags,
      daysSinceLastOrder: numericFeature(f, 'days_since_last_order'),
      openSupportCases: facts.openSupportCases,
      loyaltyBalance: facts.loyaltyBalance,
    });
    const context = buildNbaContextFromProfile({
      marketingChannels: facts.marketingChannels,
      openSupportCases: facts.openSupportCases,
      openFraudCases: facts.openFraudCases + (profile.riskFlags.includes('FRAUD_HOLD') ? 1 : 0),
      recentPurchaseProductIds: facts.recentPurchaseProductIds,
      outOfStockProductIds: facts.outOfStockProductIds,
      messagesSentLast7Days: facts.messagesSentLast7Days,
      activationChannel: input.activationChannel ?? null,
    });

    const r = await this.generate.execute({ canonicalCustomerId: input.canonicalCustomerId, actorId: input.actorId, candidates, context });
    if (!r.ok) return r;
    const decision = decideNextBestAction(candidates, context);
    return {
      ...r,
      reasonCodes: decision.reasonCodes,
      excluded: decision.candidates.filter((c) => !c.eligible).map((c) => ({ actionType: c.actionType, reason: c.exclusionReason })),
    };
  }
}
