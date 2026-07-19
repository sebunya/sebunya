import { db } from '../client';
import {
  customerProfiles, customerIdentityLinks, customerFeatureSnapshots, customerLifecycleSnapshots, nbaDecisions, nbaCandidates,
} from '../schema/customer_dna';
import { and, desc, eq, sql } from 'drizzle-orm';
import { CustomerProfileSnapshot, CustomerFeature, IdentityConfidence, LifecycleStage } from '../../../domain/customer-dna/CustomerProfile';
import { IdentityLinkSnapshot, IdentitySignalType, IdentityLinkStatus } from '../../../domain/customer-dna/CustomerIdentity';
import { NbaDecision } from '../../../domain/customer-dna/NextBestAction';
import {
  ICustomerProfileRepository, ICustomerIdentityRepository, ICustomerFeatureRepository,
  ICustomerLifecycleRepository, INbaDecisionRepository, IdentityLinkCreate,
} from '../../../application/ports/ICustomerDnaRepository';

function toProfile(r: typeof customerProfiles.$inferSelect): CustomerProfileSnapshot {
  return {
    canonicalCustomerId: r.canonicalCustomerId,
    profileVersion: r.profileVersion,
    sourceVersion: r.sourceVersion,
    accountUserId: r.accountUserId ?? null,
    identityConfidence: r.identityConfidence as IdentityConfidence,
    firstSeen: r.firstSeen ?? null,
    lastSeen: r.lastSeen ?? null,
    primaryLifecycleStage: r.primaryLifecycleStage as LifecycleStage | 'UNKNOWN',
    valueFlags: (r.valueFlags as string[]) ?? [],
    riskFlags: (r.riskFlags as string[]) ?? [],
    consentEligible: r.consentEligible ?? 'UNKNOWN',
    communicationPreferences: (r.communicationPreferences as Record<string, boolean>) ?? 'UNKNOWN',
    freshness: { computedAt: r.computedAt, staleAfterHours: r.staleAfterHours },
    computedAt: r.computedAt,
  };
}

export class DrizzleCustomerProfileRepository implements ICustomerProfileRepository {
  async create(input: { canonicalCustomerId?: string; accountUserId: string | null }): Promise<CustomerProfileSnapshot> {
    const [row] = await db.insert(customerProfiles).values({
      ...(input.canonicalCustomerId ? { canonicalCustomerId: input.canonicalCustomerId } : {}),
      accountUserId: input.accountUserId,
    }).returning();
    return toProfile(row);
  }
  async findByCanonicalId(id: string): Promise<CustomerProfileSnapshot | null> {
    const [row] = await db.select().from(customerProfiles).where(eq(customerProfiles.canonicalCustomerId, id)).limit(1);
    return row ? toProfile(row) : null;
  }
  async findByAccountUserId(accountUserId: string): Promise<CustomerProfileSnapshot | null> {
    const [row] = await db.select().from(customerProfiles).where(eq(customerProfiles.accountUserId, accountUserId)).limit(1);
    return row ? toProfile(row) : null;
  }
  async upsertProjection(s: CustomerProfileSnapshot): Promise<{ updated: boolean; profileVersion: number }> {
    // Advance only when the incoming source version strictly increases.
    const res = await db.update(customerProfiles).set({
      sourceVersion: s.sourceVersion,
      profileVersion: sql`${customerProfiles.profileVersion} + 1`,
      accountUserId: s.accountUserId,
      identityConfidence: s.identityConfidence,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      primaryLifecycleStage: s.primaryLifecycleStage,
      valueFlags: s.valueFlags,
      riskFlags: s.riskFlags,
      consentEligible: typeof s.consentEligible === 'boolean' ? s.consentEligible : null,
      communicationPreferences: typeof s.communicationPreferences === 'object' ? s.communicationPreferences : null,
      staleAfterHours: s.freshness.staleAfterHours,
      computedAt: s.computedAt,
      updatedAt: new Date(),
    }).where(and(eq(customerProfiles.canonicalCustomerId, s.canonicalCustomerId), sql`${customerProfiles.sourceVersion} < ${s.sourceVersion}`))
      .returning({ profileVersion: customerProfiles.profileVersion });
    if (res.length > 0) return { updated: true, profileVersion: res[0].profileVersion };
    const [cur] = await db.select({ v: customerProfiles.profileVersion }).from(customerProfiles).where(eq(customerProfiles.canonicalCustomerId, s.canonicalCustomerId)).limit(1);
    return { updated: false, profileVersion: cur?.v ?? s.profileVersion };
  }
  async search(query: string, limit: number): Promise<CustomerProfileSnapshot[]> {
    const q = query.trim();
    if (!q) { const rows = await db.select().from(customerProfiles).limit(limit); return rows.map(toProfile); }
    const rows = await db.select().from(customerProfiles)
      .where(sql`${customerProfiles.canonicalCustomerId}::text ilike ${'%' + q + '%'} or ${customerProfiles.accountUserId}::text ilike ${'%' + q + '%'}`)
      .limit(limit);
    return rows.map(toProfile);
  }
}

function toLink(r: typeof customerIdentityLinks.$inferSelect): IdentityLinkSnapshot {
  return {
    id: r.id, canonicalCustomerId: r.canonicalCustomerId, signalType: r.signalType as IdentitySignalType,
    identifierKey: r.identifierKey, confidence: r.confidence as IdentityConfidence, status: r.status as IdentityLinkStatus,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export class DrizzleCustomerIdentityRepository implements ICustomerIdentityRepository {
  async findByIdentifier(signalType: IdentitySignalType, identifierKey: string): Promise<IdentityLinkSnapshot | null> {
    const [row] = await db.select().from(customerIdentityLinks)
      .where(and(eq(customerIdentityLinks.signalType, signalType), eq(customerIdentityLinks.identifierKey, identifierKey))).limit(1);
    return row ? toLink(row) : null;
  }
  async listLinks(canonicalCustomerId: string): Promise<IdentityLinkSnapshot[]> {
    const rows = await db.select().from(customerIdentityLinks).where(eq(customerIdentityLinks.canonicalCustomerId, canonicalCustomerId));
    return rows.map(toLink);
  }
  async link(input: IdentityLinkCreate): Promise<{ created: boolean; link: IdentityLinkSnapshot }> {
    const inserted = await db.insert(customerIdentityLinks).values({
      canonicalCustomerId: input.canonicalCustomerId, signalType: input.signalType,
      identifierKey: input.identifierKey, confidence: input.confidence, status: input.status ?? 'ACTIVE',
    }).onConflictDoNothing({ target: [customerIdentityLinks.signalType, customerIdentityLinks.identifierKey] }).returning();
    if (inserted.length > 0) return { created: true, link: toLink(inserted[0]) };
    const existing = await this.findByIdentifier(input.signalType, input.identifierKey);
    return { created: false, link: existing! };
  }
  async setStatus(id: string, status: IdentityLinkStatus): Promise<void> {
    await db.update(customerIdentityLinks).set({ status, updatedAt: new Date() }).where(eq(customerIdentityLinks.id, id));
  }
  async listConflicts(limit: number): Promise<IdentityLinkSnapshot[]> {
    const rows = await db.select().from(customerIdentityLinks).where(eq(customerIdentityLinks.status, 'CONFLICT')).limit(limit);
    return rows.map(toLink);
  }
}

export class DrizzleCustomerFeatureRepository implements ICustomerFeatureRepository {
  async saveSnapshot(canonicalCustomerId: string, sourceVersion: number, features: CustomerFeature[]): Promise<{ created: boolean }> {
    const inserted = await db.insert(customerFeatureSnapshots)
      .values({ canonicalCustomerId, sourceVersion, features: features as unknown as object })
      .onConflictDoNothing({ target: [customerFeatureSnapshots.canonicalCustomerId, customerFeatureSnapshots.sourceVersion] })
      .returning({ id: customerFeatureSnapshots.id });
    return { created: inserted.length > 0 };
  }
  async latest(canonicalCustomerId: string) {
    const [row] = await db.select().from(customerFeatureSnapshots)
      .where(eq(customerFeatureSnapshots.canonicalCustomerId, canonicalCustomerId))
      .orderBy(desc(customerFeatureSnapshots.sourceVersion)).limit(1);
    return row ? { sourceVersion: row.sourceVersion, features: row.features as CustomerFeature[], computedAt: row.computedAt } : null;
  }
}

export class DrizzleCustomerLifecycleRepository implements ICustomerLifecycleRepository {
  async saveSnapshot(input: { canonicalCustomerId: string; stage: LifecycleStage | 'UNKNOWN'; policyVersion: number; sourceVersion: number }): Promise<{ created: boolean }> {
    const inserted = await db.insert(customerLifecycleSnapshots)
      .values({ canonicalCustomerId: input.canonicalCustomerId, stage: input.stage, policyVersion: input.policyVersion, sourceVersion: input.sourceVersion })
      .onConflictDoNothing({ target: [customerLifecycleSnapshots.canonicalCustomerId, customerLifecycleSnapshots.sourceVersion, customerLifecycleSnapshots.policyVersion] })
      .returning({ id: customerLifecycleSnapshots.id });
    return { created: inserted.length > 0 };
  }
  async latest(canonicalCustomerId: string) {
    const [row] = await db.select().from(customerLifecycleSnapshots)
      .where(eq(customerLifecycleSnapshots.canonicalCustomerId, canonicalCustomerId))
      .orderBy(desc(customerLifecycleSnapshots.sourceVersion)).limit(1);
    return row ? { stage: row.stage, policyVersion: row.policyVersion, computedAt: row.computedAt } : null;
  }
}

export class DrizzleNbaDecisionRepository implements INbaDecisionRepository {
  async saveDecision(input: { canonicalCustomerId: string; profileVersion: number; decision: NbaDecision; decisionKey: string; expiresAt: Date | null }): Promise<{ created: boolean; decisionId: string }> {
    const inserted = await db.insert(nbaDecisions).values({
      canonicalCustomerId: input.canonicalCustomerId, profileVersion: input.profileVersion,
      selectedAction: input.decision.selectedAction, selectedTargetRef: input.decision.selectedTargetRef,
      reasonCodes: input.decision.reasonCodes as unknown as object, policyVersion: input.decision.policyVersion,
      decisionKey: input.decisionKey, expiresAt: input.expiresAt,
    }).onConflictDoNothing({ target: nbaDecisions.decisionKey }).returning({ id: nbaDecisions.id });
    if (inserted.length === 0) {
      const [existing] = await db.select({ id: nbaDecisions.id }).from(nbaDecisions).where(eq(nbaDecisions.decisionKey, input.decisionKey)).limit(1);
      return { created: false, decisionId: existing.id };
    }
    const decisionId = inserted[0].id;
    if (input.decision.candidates.length > 0) {
      await db.insert(nbaCandidates).values(input.decision.candidates.map((c) => ({
        decisionId, actionType: c.actionType, targetRef: c.targetRef ?? null,
        eligible: c.eligible, exclusionReason: c.exclusionReason, score: c.score, reasonCodes: c.reasonCodes as unknown as object,
      })));
    }
    return { created: true, decisionId };
  }
  async listRecent(canonicalCustomerId: string, limit: number) {
    const decisions = await db.select().from(nbaDecisions)
      .where(eq(nbaDecisions.canonicalCustomerId, canonicalCustomerId))
      .orderBy(desc(nbaDecisions.createdAt)).limit(limit);
    const out = [] as Awaited<ReturnType<INbaDecisionRepository['listRecent']>>;
    for (const d of decisions) {
      const cands = await db.select().from(nbaCandidates).where(eq(nbaCandidates.decisionId, d.id));
      out.push({
        id: d.id, selectedAction: d.selectedAction, selectedTargetRef: d.selectedTargetRef ?? null,
        reasonCodes: (d.reasonCodes as string[]) ?? [], policyVersion: d.policyVersion, activationState: d.activationState, createdAt: d.createdAt,
        candidates: cands.map((c) => ({ actionType: c.actionType, targetRef: c.targetRef ?? null, eligible: c.eligible, exclusionReason: c.exclusionReason ?? null, score: c.score })),
      });
    }
    return out;
  }
}
