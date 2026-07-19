import { randomUUID } from 'crypto';
import { CustomerProfileSnapshot } from '../../../domain/customer-dna/CustomerProfile';
import { canLinkIdentity, resolveLinkTarget, aggregateConfidence, IdentitySignalType } from '../../../domain/customer-dna/CustomerIdentity';
import { computeFeatures, numericFeature } from '../../../domain/customer-dna/CustomerFeatures';
import { deriveLifecycle, deriveValueFlags, deriveRiskFlags } from '../../../domain/customer-dna/CustomerLifecycle';
import { NbaCandidate, NbaContext, decideNextBestAction } from '../../../domain/customer-dna/NextBestAction';
import {
  ICustomerProfileRepository, ICustomerIdentityRepository, ICustomerFeatureRepository,
  ICustomerLifecycleRepository, INbaDecisionRepository, ICustomerSignalReader,
} from '../../ports/ICustomerDnaRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

async function audit(repo: IAuditRepository, actorId: string, action: string, entity: string, entityId: string, newState: unknown, previousState?: unknown) {
  await new CreateAuditLogUseCase(repo).execute({ actorId, action, entity, entityId, previousState, newState });
}

const DAY = 86_400_000;

/**
 * Resolve an approved first-party identity signal to a canonical customer.
 * Rejects weak signals; is idempotent for a re-asserted binding; and records a
 * CONFLICT (never an automatic merge) when an identifier already binds elsewhere.
 */
export class ResolveCustomerIdentityUseCase {
  constructor(
    private readonly profiles: ICustomerProfileRepository,
    private readonly identities: ICustomerIdentityRepository,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: { signalType: string; identifierKey: string; accountUserId?: string | null; actorId: string }):
    Promise<{ ok: true; canonicalCustomerId: string; outcome: 'CREATE' | 'IDEMPOTENT' | 'CONFLICT' } | Fail> {
    const gate = canLinkIdentity({ signalType: input.signalType, identifierKey: input.identifierKey });
    if (!gate.ok) return fail(gate.reason, `Identity signal rejected: ${gate.reason}.`);

    const existing = await this.identities.findByIdentifier(gate.signalType, input.identifierKey);

    // Determine the proposed canonical: an existing account profile, else a new one.
    let proposedCanonical: string;
    if (input.accountUserId) {
      const acct = await this.profiles.findByAccountUserId(input.accountUserId);
      proposedCanonical = acct ? acct.canonicalCustomerId : (await this.profiles.create({ accountUserId: input.accountUserId })).canonicalCustomerId;
    } else if (existing) {
      proposedCanonical = existing.canonicalCustomerId;
    } else {
      proposedCanonical = (await this.profiles.create({ accountUserId: null })).canonicalCustomerId;
    }

    const target = resolveLinkTarget({ existingCanonicalForIdentifier: existing?.canonicalCustomerId ?? null, proposedCanonical });

    if (target.outcome === 'CONFLICT') {
      if (existing) await this.identities.setStatus(existing.id, 'CONFLICT');
      await audit(this.audit, input.actorId, 'CUSTOMER_IDENTITY_CONFLICT', 'customer_identity', existing?.id ?? input.identifierKey,
        { signalType: gate.signalType, existing: existing?.canonicalCustomerId, proposed: proposedCanonical });
      return { ok: true, canonicalCustomerId: target.canonicalCustomerId, outcome: 'CONFLICT' };
    }

    const { created } = await this.identities.link({
      canonicalCustomerId: target.canonicalCustomerId, signalType: gate.signalType, identifierKey: input.identifierKey, confidence: gate.confidence,
    });
    if (created) {
      await audit(this.audit, input.actorId, 'CUSTOMER_IDENTITY_LINKED', 'customer_identity', target.canonicalCustomerId,
        { signalType: gate.signalType, confidence: gate.confidence });
    }
    return { ok: true, canonicalCustomerId: target.canonicalCustomerId, outcome: created ? 'CREATE' : 'IDEMPOTENT' };
  }
}

/**
 * Recompute the canonical profile projection (features + lifecycle + summary)
 * from real signals. Idempotent: unchanged source data does not advance versions.
 */
export class ProjectCustomerProfileUseCase {
  constructor(
    private readonly profiles: ICustomerProfileRepository,
    private readonly identities: ICustomerIdentityRepository,
    private readonly features: ICustomerFeatureRepository,
    private readonly lifecycles: ICustomerLifecycleRepository,
    private readonly signals: ICustomerSignalReader,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: { canonicalCustomerId: string; actorId: string; now?: Date }): Promise<{ ok: true; advanced: boolean; sourceVersion: number } | Fail> {
    const now = input.now ?? new Date();
    const profile = await this.profiles.findByCanonicalId(input.canonicalCustomerId);
    if (!profile) return fail('NOT_FOUND', 'Customer profile not found.');

    const links = await this.identities.listLinks(input.canonicalCustomerId);
    const identifierKeys = links.filter((l) => l.status === 'ACTIVE' && (l.signalType === 'STABLE_ANONYMOUS_ID' || l.signalType === 'AUTHENTICATED_CUSTOMER_ID')).map((l) => l.identifierKey);
    const raw = await this.signals.readSignals({ accountUserId: profile.accountUserId, identifierKeys });

    const feats = computeFeatures(raw, now);
    await this.features.saveSnapshot(input.canonicalCustomerId, raw.sourceVersion, feats);

    // Lifecycle inputs computed directly from real orders.
    const activeOrders = raw.orders.filter((o) => o.status !== 'cancelled').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const orderCount = activeOrders.length;
    const daysSinceLastOrder = orderCount ? Math.floor((now.getTime() - activeOrders[orderCount - 1].createdAt.getTime()) / DAY) : null;
    let maxGap: number | null = null;
    for (let i = 1; i < activeOrders.length; i++) {
      const gap = Math.floor((activeOrders[i].createdAt.getTime() - activeOrders[i - 1].createdAt.getTime()) / DAY);
      maxGap = maxGap === null ? gap : Math.max(maxGap, gap);
    }
    const { stage, policyVersion } = deriveLifecycle({ orderCount, daysSinceLastOrder, maxInterOrderGapDays: maxGap });
    await this.lifecycles.saveSnapshot({ canonicalCustomerId: input.canonicalCustomerId, stage, policyVersion, sourceVersion: raw.sourceVersion });

    const stamps = activeOrders.map((o) => o.createdAt.getTime());
    const snapshot: CustomerProfileSnapshot = {
      canonicalCustomerId: input.canonicalCustomerId,
      profileVersion: profile.profileVersion,
      sourceVersion: raw.sourceVersion,
      accountUserId: profile.accountUserId,
      identityConfidence: aggregateConfidence(links),
      firstSeen: stamps.length ? new Date(Math.min(...stamps)) : profile.firstSeen,
      lastSeen: stamps.length ? new Date(Math.max(...stamps)) : profile.lastSeen,
      primaryLifecycleStage: stage,
      valueFlags: deriveValueFlags({ lifetimeValueUgx: numericFeature(feats, 'lifetime_value_ugx'), orderCount }),
      riskFlags: deriveRiskFlags({ deliverySuccessRate: numericFeature(feats, 'delivery_success_rate'), backorderExposure: raw.backorderCount }),
      consentEligible: 'UNKNOWN',
      communicationPreferences: 'UNKNOWN',
      freshness: { computedAt: now, staleAfterHours: 24 },
      computedAt: now,
    };
    const res = await this.profiles.upsertProjection(snapshot);
    if (res.updated) {
      await audit(this.audit, input.actorId, 'CUSTOMER_PROFILE_PROJECTED', 'customer_profile', input.canonicalCustomerId, { sourceVersion: raw.sourceVersion, stage });
    }
    return { ok: true, advanced: res.updated, sourceVersion: raw.sourceVersion };
  }
}

/** Generate and persist the next-best action. Idempotent per decision key. */
export class GenerateNextBestActionUseCase {
  constructor(
    private readonly profiles: ICustomerProfileRepository,
    private readonly decisions: INbaDecisionRepository,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: { canonicalCustomerId: string; actorId: string; candidates: NbaCandidate[]; context: NbaContext; decisionKey?: string; ttlMinutes?: number }):
    Promise<{ ok: true; selectedAction: string; created: boolean; decisionId: string } | Fail> {
    const profile = await this.profiles.findByCanonicalId(input.canonicalCustomerId);
    if (!profile) return fail('NOT_FOUND', 'Customer profile not found.');
    const decision = decideNextBestAction(input.candidates, input.context);
    const decisionKey = input.decisionKey ?? `nba:${input.canonicalCustomerId}:${profile.profileVersion}:${input.context.policyVersion}`;
    const expiresAt = input.ttlMinutes ? new Date(Date.now() + input.ttlMinutes * 60_000) : null;
    const saved = await this.decisions.saveDecision({ canonicalCustomerId: input.canonicalCustomerId, profileVersion: profile.profileVersion, decision, decisionKey, expiresAt });
    if (saved.created) {
      await audit(this.audit, input.actorId, 'NBA_DECISION_RECORDED', 'nba_decision', saved.decisionId, { selectedAction: decision.selectedAction, reasonCodes: decision.reasonCodes });
    }
    return { ok: true, selectedAction: decision.selectedAction, created: saved.created, decisionId: saved.decisionId };
  }
}

/** Admin read: profile summary + latest features + lifecycle + links + recent decisions. */
export class GetCustomerDnaUseCase {
  constructor(
    private readonly profiles: ICustomerProfileRepository,
    private readonly identities: ICustomerIdentityRepository,
    private readonly features: ICustomerFeatureRepository,
    private readonly lifecycles: ICustomerLifecycleRepository,
    private readonly decisions: INbaDecisionRepository
  ) {}
  async execute(canonicalCustomerId: string) {
    const profile = await this.profiles.findByCanonicalId(canonicalCustomerId);
    if (!profile) return fail('NOT_FOUND', 'Customer profile not found.');
    const [links, latestFeatures, latestLifecycle, recentDecisions] = await Promise.all([
      this.identities.listLinks(canonicalCustomerId),
      this.features.latest(canonicalCustomerId),
      this.lifecycles.latest(canonicalCustomerId),
      this.decisions.listRecent(canonicalCustomerId, 10),
    ]);
    // Mask identifier keys — never expose a raw identifier in the admin surface.
    const maskedLinks = links.map((l) => ({
      signalType: l.signalType, confidence: l.confidence, status: l.status,
      identifierMasked: l.identifierKey.length > 8 ? `${l.identifierKey.slice(0, 4)}…${l.identifierKey.slice(-4)}` : '••••',
      createdAt: l.createdAt,
    }));
    return { ok: true as const, profile, links: maskedLinks, features: latestFeatures, lifecycle: latestLifecycle, decisions: recentDecisions };
  }
  async search(query: string, limit: number) {
    return this.profiles.search(query, Math.min(Math.max(1, limit), 50));
  }
  async listConflicts(limit: number) {
    return this.identities.listConflicts(Math.min(Math.max(1, limit), 100));
  }
}
