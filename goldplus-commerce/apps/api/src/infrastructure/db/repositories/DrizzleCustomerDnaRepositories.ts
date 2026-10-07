import { db } from '../client';
import {
  customerProfiles, customerIdentityLinks, customerFeatureSnapshots, customerLifecycleSnapshots, nbaDecisions, nbaCandidates,
} from '../schema/customer_dna';
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { users } from '../schema/identity';
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
    const consent = typeof s.consentEligible === 'boolean' ? s.consentEligible : null;
    const prefs = typeof s.communicationPreferences === 'object' ? s.communicationPreferences : null;
    const valueFlags = JSON.stringify(s.valueFlags);
    const riskFlags = JSON.stringify(s.riskFlags);
    // Advance when the data is newer OR the derived result changed: a stage
    // moves with time alone (ACTIVE -> AT_RISK -> LAPSED with no new order).
    // It used to advance on newer data only, so stages froze.
    // jsonb here is written by the driver as an encoded string ('"[]"'), so it
    // is decoded before comparing, and the new value goes in as TEXT (a param
    // typed jsonb is JSON-encoded again by the driver); timestamps are compared at millisecond
    // precision (a JS Date has no microseconds, Postgres does).
    const asJson = (col: unknown) => sql`(case when jsonb_typeof(${col}) = 'string' then (${col} #>> '{}')::jsonb else ${col} end)`;
    const ms = (v: unknown) => sql`date_trunc('second', ${v})`;
    const at = (d: Date | null) => (d ? sql`${d.toISOString()}::timestamptz` : sql`null::timestamptz`);
    const changed = sql`(${customerProfiles.sourceVersion} < ${s.sourceVersion}
      or ${customerProfiles.primaryLifecycleStage} is distinct from ${s.primaryLifecycleStage}
      or ${asJson(customerProfiles.valueFlags)} is distinct from ${valueFlags}::text::jsonb
      or ${asJson(customerProfiles.riskFlags)} is distinct from ${riskFlags}::text::jsonb
      or ${customerProfiles.identityConfidence} is distinct from ${s.identityConfidence}
      or ${customerProfiles.consentEligible} is distinct from ${consent}
      or ${ms(customerProfiles.firstSeen)} is distinct from ${ms(at(s.firstSeen))}
      or ${ms(customerProfiles.lastSeen)} is distinct from ${ms(at(s.lastSeen))})`;
    const res = await db.update(customerProfiles).set({
      sourceVersion: sql`greatest(${customerProfiles.sourceVersion}, ${s.sourceVersion})`,
      profileVersion: sql`${customerProfiles.profileVersion} + 1`,
      accountUserId: s.accountUserId,
      identityConfidence: s.identityConfidence,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      primaryLifecycleStage: s.primaryLifecycleStage,
      valueFlags: s.valueFlags,
      riskFlags: s.riskFlags,
      consentEligible: consent,
      communicationPreferences: prefs,
      staleAfterHours: s.freshness.staleAfterHours,
      computedAt: s.computedAt,
      updatedAt: new Date(),
    }).where(and(eq(customerProfiles.canonicalCustomerId, s.canonicalCustomerId), changed))
      .returning({ profileVersion: customerProfiles.profileVersion });
    if (res.length > 0) return { updated: true, profileVersion: res[0].profileVersion };
    // Unchanged: record that it was checked (the nightly batch takes the oldest
    // first), without a new profile version.
    const [cur] = await db.update(customerProfiles).set({ computedAt: s.computedAt })
      .where(eq(customerProfiles.canonicalCustomerId, s.canonicalCustomerId))
      .returning({ v: customerProfiles.profileVersion });
    return { updated: false, profileVersion: cur?.v ?? s.profileVersion };
  }
  async search(query: string, limit: number): Promise<CustomerProfileSnapshot[]> {
    const q = query.trim();
    const live = isNull(customerProfiles.mergedInto); // a merged guest profile is not a customer of its own
    const recentFirst = [sql`${customerProfiles.lastSeen} desc nulls last`, desc(customerProfiles.computedAt)];
    if (!q) {
      const rows = await db.select().from(customerProfiles).where(live).orderBy(...recentFirst).limit(limit);
      return rows.map(toProfile);
    }
    // An admin knows a customer by email or phone, not by a uuid. Exact on
    // phone digits (last 9, so 0772… and +256772… both match), contains on email.
    const digits = q.replace(/\D/g, '');
    const byContact = q.includes('@')
      ? sql`${users.email} ilike ${'%' + q.toLowerCase() + '%'}`
      : digits.length >= 9
        ? sql`right(regexp_replace(coalesce(${users.phone}, ''), '\D', '', 'g'), 9) = ${digits.slice(-9)}`
        : sql`false`;
    const rows = await db.select({ p: customerProfiles }).from(customerProfiles)
      .leftJoin(users, eq(users.id, customerProfiles.accountUserId))
      .where(and(live, sql`(${byContact} or ${customerProfiles.canonicalCustomerId}::text ilike ${'%' + q + '%'} or ${customerProfiles.accountUserId}::text ilike ${'%' + q + '%'})`))
      .orderBy(...recentFirst)
      .limit(limit);
    return rows.map((r) => toProfile(r.p));
  }
  async stageCounts(): Promise<Record<string, number>> {
    const rows = await db.select({ stage: customerProfiles.primaryLifecycleStage, n: sql<number>`count(*)::int` })
      .from(customerProfiles).where(isNull(customerProfiles.mergedInto)).groupBy(customerProfiles.primaryLifecycleStage);
    return Object.fromEntries(rows.map((r) => [r.stage, Number(r.n)]));
  }
  async listForReprojection(limit: number, computedBefore: Date): Promise<string[]> {
    const rows = await db.select({ id: customerProfiles.canonicalCustomerId }).from(customerProfiles)
      .where(and(isNull(customerProfiles.mergedInto), lt(customerProfiles.computedAt, computedBefore)))
      .orderBy(asc(customerProfiles.computedAt)).limit(limit);
    return rows.map((r) => r.id);
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
    const rows = await db.select().from(customerIdentityLinks).where(eq(customerIdentityLinks.status, 'CONFLICT')).orderBy(desc(customerIdentityLinks.updatedAt)).limit(limit);
    return rows.map(toLink);
  }
}

export class DrizzleCustomerFeatureRepository implements ICustomerFeatureRepository {
  async saveSnapshot(canonicalCustomerId: string, sourceVersion: number, features: CustomerFeature[]): Promise<{ created: boolean }> {
    const inserted = await db.insert(customerFeatureSnapshots)
      .values({ canonicalCustomerId, sourceVersion, features: features as unknown as object })
      // Same source data, later clock: days-since and recency features change
      // with time, so the snapshot for this source version is refreshed.
      .onConflictDoUpdate({ target: [customerFeatureSnapshots.canonicalCustomerId, customerFeatureSnapshots.sourceVersion], set: { features: features as unknown as object, computedAt: new Date() } })
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
      .onConflictDoUpdate({ target: [customerLifecycleSnapshots.canonicalCustomerId, customerLifecycleSnapshots.sourceVersion, customerLifecycleSnapshots.policyVersion], set: { stage: input.stage, computedAt: new Date() } })
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
    // The decision and the candidate set it was chosen from are one record.
    // Committed separately, a failure between them left a decision whose
    // reasoning could never be reconstructed, and the decisionKey conflict
    // made that permanent: the retry found the decision already there and
    // never wrote the candidates.
    return db.transaction(async (tx) => {
      const inserted = await tx.insert(nbaDecisions).values({
        canonicalCustomerId: input.canonicalCustomerId, profileVersion: input.profileVersion,
        selectedAction: input.decision.selectedAction, selectedTargetRef: input.decision.selectedTargetRef,
        reasonCodes: input.decision.reasonCodes as unknown as object, policyVersion: input.decision.policyVersion,
        decisionKey: input.decisionKey, expiresAt: input.expiresAt,
      }).onConflictDoNothing({ target: nbaDecisions.decisionKey }).returning({ id: nbaDecisions.id });
      if (inserted.length === 0) {
        const [existing] = await tx.select({ id: nbaDecisions.id }).from(nbaDecisions).where(eq(nbaDecisions.decisionKey, input.decisionKey)).limit(1);
        if (!existing) throw new Error('NBA_DECISION_VANISHED');
        return { created: false, decisionId: existing.id };
      }
      const decisionId = inserted[0].id;
      if (input.decision.candidates.length > 0) {
        await tx.insert(nbaCandidates).values(input.decision.candidates.map((c) => ({
          decisionId, actionType: c.actionType, targetRef: c.targetRef ?? null,
          eligible: c.eligible, exclusionReason: c.exclusionReason, score: c.score, reasonCodes: c.reasonCodes as unknown as object,
        })));
      }
      return { created: true, decisionId };
    });
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
