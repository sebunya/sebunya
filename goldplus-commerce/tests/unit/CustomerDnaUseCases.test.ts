import { describe, it, expect } from 'vitest';
import { ResolveCustomerIdentityUseCase, GenerateNextBestActionUseCase } from '../../apps/api/src/application/use-cases/customer-dna/CustomerDnaUseCases';
import { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';
import { ICustomerProfileRepository, ICustomerIdentityRepository, INbaDecisionRepository } from '../../apps/api/src/application/ports/ICustomerDnaRepository';
import { NbaContext, NbaCandidate } from '../../apps/api/src/domain/customer-dna/NextBestAction';
import { randomUUID } from 'crypto';

class SpyAudit implements IAuditRepository {
  saved: any[] = [];
  async save(l: any) { this.saved.push(l); }
  async findAll() { return this.saved; }
  async findByEntity() { return []; }
}
class Profiles implements ICustomerProfileRepository {
  rows = new Map<string, any>();
  async create(input: { canonicalCustomerId?: string; accountUserId: string | null }) {
    const id = input.canonicalCustomerId ?? randomUUID();
    const p = { canonicalCustomerId: id, profileVersion: 1, sourceVersion: 0, accountUserId: input.accountUserId, identityConfidence: 'LOW', firstSeen: null, lastSeen: null, primaryLifecycleStage: 'UNKNOWN', valueFlags: [], riskFlags: [], consentEligible: 'UNKNOWN', communicationPreferences: 'UNKNOWN', freshness: { computedAt: new Date(), staleAfterHours: 24 }, computedAt: new Date() } as any;
    this.rows.set(id, p); return p;
  }
  async findByCanonicalId(id: string) { return this.rows.get(id) ?? null; }
  async findByAccountUserId(uid: string) { return [...this.rows.values()].find((p) => p.accountUserId === uid) ?? null; }
  async upsertProjection(s: any) { this.rows.set(s.canonicalCustomerId, s); return { updated: true, profileVersion: s.profileVersion }; }
  async search() { return []; }
}
class Identities implements ICustomerIdentityRepository {
  links: any[] = [];
  async findByIdentifier(signalType: string, key: string) { return this.links.find((l) => l.signalType === signalType && l.identifierKey === key) ?? null; }
  async listLinks(cid: string) { return this.links.filter((l) => l.canonicalCustomerId === cid); }
  async link(input: any) {
    const existing = await this.findByIdentifier(input.signalType, input.identifierKey);
    if (existing) return { created: false, link: existing };
    const link = { id: randomUUID(), status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...input };
    this.links.push(link); return { created: true, link };
  }
  async setStatus(id: string, status: any) { const l = this.links.find((x) => x.id === id); if (l) l.status = status; }
  async listConflicts() { return this.links.filter((l) => l.status === 'CONFLICT'); }
}
class Decisions implements INbaDecisionRepository {
  rows: any[] = [];
  async saveDecision(input: any) {
    const existing = this.rows.find((r) => r.decisionKey === input.decisionKey);
    if (existing) return { created: false, decisionId: existing.id };
    const id = randomUUID(); this.rows.push({ id, ...input }); return { created: true, decisionId: id };
  }
  async listRecent() { return []; }
}

describe('Customer DNA — ResolveCustomerIdentity use case', () => {
  it('rejects a weak signal', async () => {
    const r = await new ResolveCustomerIdentityUseCase(new Profiles(), new Identities(), new SpyAudit())
      .execute({ signalType: 'BROWSER_SIMILARITY', identifierKey: 'x', actorId: 'a' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNAPPROVED_SIGNAL');
  });
  it('creates then is idempotent for the same account link', async () => {
    const profiles = new Profiles(); const identities = new Identities();
    const uc = new ResolveCustomerIdentityUseCase(profiles, identities, new SpyAudit());
    const uid = randomUUID();
    const r1 = await uc.execute({ signalType: 'AUTHENTICATED_CUSTOMER_ID', identifierKey: uid, accountUserId: uid, actorId: 'a' });
    const r2 = await uc.execute({ signalType: 'AUTHENTICATED_CUSTOMER_ID', identifierKey: uid, accountUserId: uid, actorId: 'a' });
    expect(r1.ok && r1.outcome).toBe('CREATE');
    expect(r2.ok && r2.outcome).toBe('IDEMPOTENT');
    expect(identities.links.length).toBe(1);
  });
  it('records a CONFLICT rather than auto-merging a shared verified email', async () => {
    const profiles = new Profiles(); const identities = new Identities(); const audit = new SpyAudit();
    const uc = new ResolveCustomerIdentityUseCase(profiles, identities, audit);
    const key = 'hash-shared';
    await uc.execute({ signalType: 'VERIFIED_EMAIL', identifierKey: key, actorId: 'a' });
    const r = await uc.execute({ signalType: 'VERIFIED_EMAIL', identifierKey: key, accountUserId: randomUUID(), actorId: 'a' });
    expect(r.ok && r.outcome).toBe('CONFLICT');
    expect(identities.links[0].status).toBe('CONFLICT');
    expect(audit.saved.some((a) => a.action === 'CUSTOMER_IDENTITY_CONFLICT')).toBe(true);
  });
});

describe('Customer DNA — GenerateNextBestAction use case', () => {
  const ctx = (over: Partial<NbaContext> = {}): NbaContext => ({
    consentEligible: true, channelEligible: { email: true }, activationChannel: 'email', openSupportCase: false, fraudHold: false,
    frequencyCapReached: false, recentPurchaseRefs: [], outOfStockRefs: [], incompatibleRefs: [], invalidPromotionRefs: [], policyVersion: 1, ...over,
  });
  const rec = (ref: string): NbaCandidate => ({ actionType: 'RECOMMEND_PRODUCT', targetRef: ref, baseScore: 10, reasonCodes: [] });

  it('persists a decision and is idempotent per decision key', async () => {
    const profiles = new Profiles(); const decisions = new Decisions();
    const p = await profiles.create({ accountUserId: null });
    const uc = new GenerateNextBestActionUseCase(profiles, decisions, new SpyAudit());
    const r1 = await uc.execute({ canonicalCustomerId: p.canonicalCustomerId, actorId: 'a', candidates: [rec('p1')], context: ctx(), decisionKey: 'k1' });
    const r2 = await uc.execute({ canonicalCustomerId: p.canonicalCustomerId, actorId: 'a', candidates: [rec('p1')], context: ctx(), decisionKey: 'k1' });
    expect(r1.ok && r1.selectedAction).toBe('RECOMMEND_PRODUCT');
    expect(r1.ok && r1.created).toBe(true);
    expect(r2.ok && r2.created).toBe(false);
    expect(decisions.rows.length).toBe(1);
  });
  it('persists NO_ACTION when consent excludes everything', async () => {
    const profiles = new Profiles(); const decisions = new Decisions();
    const p = await profiles.create({ accountUserId: null });
    const uc = new GenerateNextBestActionUseCase(profiles, decisions, new SpyAudit());
    const r = await uc.execute({ canonicalCustomerId: p.canonicalCustomerId, actorId: 'a', candidates: [rec('p1')], context: ctx({ consentEligible: false }), decisionKey: 'k2' });
    expect(r.ok && r.selectedAction).toBe('NO_ACTION');
  });
});
