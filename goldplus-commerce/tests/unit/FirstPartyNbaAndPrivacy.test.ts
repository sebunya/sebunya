import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildNbaContextFromProfile, buildProfileDrivenCandidates, decideNextBestAction, NBA_MAX_MESSAGES_PER_7_DAYS } from '../../apps/api/src/domain/customer-dna/NextBestAction';
import { DecideNextBestActionUseCase } from '../../apps/api/src/application/use-cases/first-party/DecideNextBestActionUseCase';
import {
  EXPORTS_PER_DAY, erasedEmailFor, isOpenOrder, mayFulfilErasure, mayRequestExport, privacyReference,
} from '../../apps/api/src/domain/first-party/PrivacyRequests';
import { PrivacyRequestUseCases } from '../../apps/api/src/application/use-cases/first-party/PrivacyRequestUseCases';
import { hashForAdPlatforms, hashesForPlatform, googleNormalisedEmail } from '../../apps/api/src/domain/first-party/AudienceHashing';
import { hashedContactFor } from '../../apps/api/src/domain/advertising/ContactNormalisation';
import { validateSegmentDefinition, evaluateSegment, segmentMembers, describeRule } from '../../apps/api/src/domain/first-party/Segments';
import type { CustomerFacts } from '../../apps/api/src/domain/first-party/CustomerFacts';
import { PERMISSIONS, ROLE_PERMISSION_BASELINES } from '@goldplus/shared';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const DAY = 86_400_000;
const NOW = new Date('2026-09-25T09:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

// ── Next-best action from the real profile ──────────────────────────────────
const facts = (p: Partial<Parameters<typeof buildNbaContextFromProfile>[0]> = {}) => ({
  marketingChannels: {}, openSupportCases: 0, openFraudCases: 0, recentPurchaseProductIds: [], outOfStockProductIds: [],
  messagesSentLast7Days: 0, activationChannel: null, ...p,
});

describe('NBA context is read, not assumed', () => {
  it('consent is eligible only where a channel is granted; unknown message counts fail closed', () => {
    expect(buildNbaContextFromProfile(facts()).consentEligible).toBe(false);
    const c = buildNbaContextFromProfile(facts({ marketingChannels: { whatsapp: true, email: false } }));
    expect(c.consentEligible).toBe(true);
    expect(c.channelEligible).toEqual({ whatsapp: true, email: false });
    expect(buildNbaContextFromProfile(facts({ messagesSentLast7Days: null })).frequencyCapReached).toBe(true);
    expect(buildNbaContextFromProfile(facts({ messagesSentLast7Days: NBA_MAX_MESSAGES_PER_7_DAYS })).frequencyCapReached).toBe(true);
    expect(buildNbaContextFromProfile(facts({ messagesSentLast7Days: 1 })).frequencyCapReached).toBe(false);
    expect(buildNbaContextFromProfile(facts({ openFraudCases: 1 })).fraudHold).toBe(true);
    expect(buildNbaContextFromProfile(facts({ openSupportCases: 2 })).openSupportCase).toBe(true);
  });

  it('an open support ticket makes follow-up the action and holds marketing back', () => {
    const candidates = buildProfileDrivenCandidates({ lifecycleStage: 'LAPSED', cartAbandonments: 1, backorderExposure: 0, riskFlags: [], daysSinceLastOrder: 90, openSupportCases: 1, loyaltyBalance: 500 });
    const d = decideNextBestAction(candidates, buildNbaContextFromProfile(facts({ openSupportCases: 1, marketingChannels: { whatsapp: true } })));
    expect(d.selectedAction).toBe('SUPPORT_FOLLOW_UP');
    expect(d.candidates.find((c) => c.actionType === 'RETENTION')?.exclusionReason).toBe('OPEN_SUPPORT_CASE');
  });

  it('without marketing consent, retention/loyalty are excluded for CONSENT_REQUIRED; resuming a basket is not marketing', () => {
    const candidates = buildProfileDrivenCandidates({ lifecycleStage: 'AT_RISK', cartAbandonments: 1, backorderExposure: 0, riskFlags: [], daysSinceLastOrder: 60, loyaltyBalance: 200 });
    const d = decideNextBestAction(candidates, buildNbaContextFromProfile(facts()));
    expect(d.selectedAction).toBe('RESUME_CART');
    expect(d.candidates.filter((c) => c.exclusionReason === 'CONSENT_REQUIRED').map((c) => c.actionType).sort()).toEqual(['LOYALTY_ACTION', 'RETENTION']);
  });

  it('the use case projects a customer with no features first, reads the context, and reports what was not chosen', async () => {
    const id = randomUUID();
    let projected = 0;
    let features: any = null;
    const generated: any[] = [];
    const uc = new DecideNextBestActionUseCase(
      { async findByCanonicalId() { return { canonicalCustomerId: id, accountUserId: randomUUID(), primaryLifecycleStage: 'LAPSED', riskFlags: [], profileVersion: 1 } as any; } } as any,
      { async latest() { return features; } } as any,
      { async latest() { return { stage: 'LAPSED', policyVersion: 1, computedAt: NOW }; } } as any,
      { async execute() { projected++; features = { sourceVersion: 1, computedAt: NOW, features: [{ key: 'cart_abandonments', value: 0 }, { key: 'backorder_exposure', value: 0 }] }; return { ok: true, advanced: true, sourceVersion: 1 }; } } as any,
      { async read() { return { marketingChannels: { whatsapp: false }, openSupportCases: 0, openFraudCases: 0, recentPurchaseProductIds: [], outOfStockProductIds: [], messagesSentLast7Days: 0, loyaltyBalance: null }; } },
      { async execute(input: any) { generated.push(input); const d = decideNextBestAction(input.candidates, input.context); return { ok: true, selectedAction: d.selectedAction, created: true, decisionId: randomUUID() }; } } as any,
    );
    const r = await uc.execute({ canonicalCustomerId: id, actorId: randomUUID(), activationChannel: 'whatsapp' });
    expect(projected).toBe(1);
    expect(r.ok && r.selectedAction).toBe('NO_ACTION');
    expect(r.ok && r.excluded).toEqual([{ actionType: 'RETENTION', reason: 'CONSENT_REQUIRED' }]);
    expect(generated[0].context).toMatchObject({ consentEligible: false, channelEligible: { whatsapp: false }, activationChannel: 'whatsapp', policyVersion: 2 });
  });

  it('the NBA route no longer builds a placeholder context, and the signal reader no longer hard-codes', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/customer-dna.ts');
    expect(route).toMatch(/decideNextBestActionUseCase\.execute/);
    expect(route).not.toMatch(/openSupportCase: false|frequencyCapReached: false|recentPurchaseRefs: \[\]/);
    const reader = read('apps/api/src/infrastructure/db/repositories/DrizzleCustomerSignalReader.ts');
    expect(reader).not.toMatch(/paymentMethod: null, status/);
    expect(reader).toMatch(/supportIssues\.customerId/);
    expect(reader).toMatch(/\n      supportInteractions,\n/);
    const ctx = read('apps/api/src/infrastructure/first-party/DrizzleNbaContextReader.ts');
    expect(ctx).toMatch(/status = 'SENT'/);
    expect(ctx).toMatch(/fraud_cases where status in \('OPEN', 'IN_REVIEW'\)/);
    expect(ctx).toMatch(/whatsapp\.mayMarket/);
  });
});

// ── Privacy requests ─────────────────────────────────────────────────────────
describe('privacy policy (pure)', () => {
  it('erasure needs an open request, the typed reference, and no open orders', () => {
    const base = { status: 'RECEIVED' as const, kind: 'DELETE_ACCOUNT' as const, openOrders: 0, confirmation: 'pr-abc234', reference: 'PR-ABC234' };
    expect(mayFulfilErasure(base)).toEqual({ ok: true });
    expect(mayFulfilErasure({ ...base, confirmation: 'PR-XXXXXX' })).toEqual({ ok: false, code: 'CONFIRMATION_MISMATCH' });
    expect(mayFulfilErasure({ ...base, openOrders: 1 })).toEqual({ ok: false, code: 'OPEN_ORDERS' });
    expect(mayFulfilErasure({ ...base, status: 'COMPLETED' })).toEqual({ ok: false, code: 'NOT_OPEN' });
    expect(mayFulfilErasure({ ...base, kind: 'EXPORT' })).toEqual({ ok: false, code: 'NOT_AN_ERASURE' });
  });

  it('open orders, references, placeholders and the export limit', () => {
    expect(isOpenOrder('received')).toBe(true);
    expect(isOpenOrder('processing')).toBe(true);
    expect(isOpenOrder('DELIVERED')).toBe(false);
    expect(isOpenOrder('cancelled')).toBe(false);
    expect(privacyReference(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe('PR-234567');
    expect(privacyReference(new Uint8Array(6).fill(255))).toMatch(/^PR-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    const id = randomUUID();
    expect(erasedEmailFor(id)).toMatch(/^erased-[0-9a-f]{16}@erased\.invalid$/);
    expect(mayRequestExport(EXPORTS_PER_DAY - 1)).toEqual({ ok: true });
    expect(mayRequestExport(EXPORTS_PER_DAY)).toEqual({ ok: false, code: 'EXPORT_LIMIT' });
  });
});

class PrivacyWorld {
  requests: any[] = [];
  audits: any[] = [];
  openOrders = 0;
  erased: any[] = [];
  eraseCompletes = true;
}
function privacy(w: PrivacyWorld) {
  let n = 0;
  const repo = {
    async create(input: any) {
      if (input.idempotencyKey) { const same = w.requests.find((r) => r.idempotencyKey === input.idempotencyKey); if (same) return { record: same, created: false }; }
      if (input.status === 'RECEIVED') { const open = w.requests.find((r) => r.userId === input.userId && r.kind === input.kind && r.status === 'RECEIVED'); if (open) return { record: open, created: false }; }
      const rec = { id: randomUUID(), decidedBy: null, decidedAt: null, decisionReason: null, completedAt: input.status === 'COMPLETED' ? NOW : null, requestedAt: NOW, result: input.result ?? {}, ...input };
      w.requests.push(rec);
      return { record: rec, created: true };
    },
    async findById(id: string) { return w.requests.find((r) => r.id === id) ?? null; },
    async listForUser(uid: string) { return w.requests.filter((r) => r.userId === uid); },
    async list() { return w.requests; },
    async countExportsSince(uid: string) { return w.requests.filter((r) => r.userId === uid && r.kind === 'EXPORT').length; },
    async transition(id: string, input: any) { const r = w.requests.find((x) => x.id === id && x.status === 'RECEIVED'); if (!r) return false; r.status = input.to; r.decisionReason = input.reason; return true; },
  };
  const exporter = { async collect(uid: string) { return uid === 'gone' ? null : { sections: { account: { email: 'a@b.co' } }, counts: { orders: 2 } }; } };
  const eraser = {
    async openOrderCount() { return w.openOrders; },
    async erase(input: any) {
      if (!w.eraseCompletes) return { completed: false, counts: {} };
      w.erased.push(input);
      const r = w.requests.find((x) => x.id === input.requestId); if (r) r.status = 'COMPLETED';
      return { completed: true, counts: { orders: 2, account: input.kind === 'DELETE_ACCOUNT' ? 1 : 0 } };
    },
  };
  const audit = { async save(l: any) { w.audits.push(l); }, async findAll() { return []; }, async findByEntity() { return []; } };
  return new PrivacyRequestUseCases(repo as any, exporter as any, eraser as any, audit as any, () => NOW, () => `PR-ABC${(n++).toString().padStart(3, '2')}`);
}

describe('privacy requests (use cases)', () => {
  it('export: served at once, recorded as COMPLETED, audited, and limited per day', async () => {
    const w = new PrivacyWorld();
    const uc = privacy(w);
    const user = randomUUID();
    const r = await uc.exportMyData(user);
    expect(r.ok && r.data).toMatchObject({ account: { email: 'a@b.co' }, reference: expect.stringMatching(/^PR-/) });
    expect(w.requests[0]).toMatchObject({ kind: 'EXPORT', status: 'COMPLETED', result: { counts: { orders: 2 } } });
    expect(w.audits[0]).toMatchObject({ action: 'PRIVACY_EXPORT_SERVED', entity: 'privacy_request', actorId: user });
    for (let i = 1; i < EXPORTS_PER_DAY; i++) await uc.exportMyData(user);
    expect(await uc.exportMyData(user)).toMatchObject({ ok: false, code: 'EXPORT_LIMIT' });
  });

  it('erasure requests are idempotent, one open per kind, and only the owner may withdraw', async () => {
    const w = new PrivacyWorld();
    const uc = privacy(w);
    const user = randomUUID();
    expect(await uc.requestErasure({ userId: user, kind: 'EXPORT' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    const first = await uc.requestErasure({ userId: user, kind: 'DELETE_ACCOUNT', note: '  please  ', idempotencyKey: 'k1' });
    expect(first).toMatchObject({ ok: true, alreadyOpen: false, request: { status: 'RECEIVED' } });
    expect(await uc.requestErasure({ userId: user, kind: 'DELETE_ACCOUNT', idempotencyKey: 'k2' })).toMatchObject({ ok: true, alreadyOpen: true });
    expect(w.requests).toHaveLength(1);
    expect(w.requests[0].customerNote).toBe('please');
    const id = first.ok ? first.request.id : '';
    expect(await uc.withdraw({ userId: randomUUID(), requestId: id })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await uc.withdraw({ userId: user, requestId: id })).toEqual({ ok: true });
    expect(w.audits.map((a) => a.action)).toEqual(['PRIVACY_REQUEST_RECEIVED', 'PRIVACY_REQUEST_WITHDRAWN']);
  });

  it('a person carries it out only with the typed reference and no open orders; it is audited with counts', async () => {
    const w = new PrivacyWorld();
    const uc = privacy(w);
    const staff = randomUUID();
    const req = await uc.requestErasure({ userId: randomUUID(), kind: 'DELETE_ACCOUNT' });
    const { id, reference } = req.ok ? req.request : { id: '', reference: '' };
    expect(await uc.fulfil({ requestId: id, actorId: staff, confirmation: reference, reason: 'x' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await uc.fulfil({ requestId: id, actorId: staff, confirmation: 'PR-NOPE22', reason: 'called the account phone' })).toMatchObject({ ok: false, code: 'CONFIRMATION_MISMATCH' });
    w.openOrders = 1;
    expect(await uc.fulfil({ requestId: id, actorId: staff, confirmation: reference, reason: 'called the account phone' })).toMatchObject({ ok: false, code: 'OPEN_ORDERS' });
    expect(w.erased).toHaveLength(0);
    w.openOrders = 0;
    const done = await uc.fulfil({ requestId: id, actorId: staff, confirmation: reference.toLowerCase(), reason: 'called the account phone' });
    expect(done).toEqual({ ok: true, counts: { orders: 2, account: 1 } });
    expect(w.erased[0]).toMatchObject({ kind: 'DELETE_ACCOUNT', requestId: id, actorId: staff });
    expect(w.audits.at(-1)).toMatchObject({ action: 'PRIVACY_REQUEST_COMPLETED', actorId: staff });
    expect(await uc.fulfil({ requestId: id, actorId: staff, confirmation: reference, reason: 'again please' })).toMatchObject({ ok: false, code: 'NOT_OPEN' });
  });

  it('a request closed by someone else meanwhile changes nothing; declining needs a reason the customer sees', async () => {
    const w = new PrivacyWorld();
    w.eraseCompletes = false;
    const uc = privacy(w);
    const req = await uc.requestErasure({ userId: randomUUID(), kind: 'ANONYMISE_HISTORY' });
    const { id, reference } = req.ok ? req.request : { id: '', reference: '' };
    expect(await uc.fulfil({ requestId: id, actorId: randomUUID(), confirmation: reference, reason: 'checked by phone' })).toMatchObject({ ok: false, code: 'NOT_OPEN' });
    expect(w.audits.some((a) => a.action === 'PRIVACY_REQUEST_COMPLETED')).toBe(false);
    expect(await uc.decline({ requestId: id, actorId: randomUUID(), reason: 'no' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await uc.decline({ requestId: id, actorId: randomUUID(), reason: 'We could not confirm it came from you.' })).toEqual({ ok: true });
    const mine = await uc.listMine(w.requests[0].userId);
    expect(mine[0]).toMatchObject({ status: 'DECLINED', decisionReason: 'We could not confirm it came from you.' });
  });

  it('the eraser is one transaction, claims the request first, keeps consent evidence and amounts, and never exports cost', () => {
    const src = read('apps/api/src/infrastructure/first-party/DrizzlePrivacyRepositories.ts');
    expect(src).toMatch(/return db\.transaction\(async \(tx\) =>/);
    expect(src).toMatch(/where id = \$\{input\.requestId\}::uuid and status = 'RECEIVED'/);
    expect(src).not.toMatch(/delete from (consent_events|customer_consent_states|consent_current_state|orders|order_items)/);
    expect(src).not.toMatch(/total_amount = |subtotal_amount = /);
    expect(src).not.toMatch(/cogs_snapshot/);
    expect(src).toMatch(/erasedEmailFor\(input\.userId\)/);
  });

  it('routes: customer side behind the customer session, staff side behind privacy_requests.manage; mounted', () => {
    const acct = read('apps/api/src/interfaces/http/routes/account-privacy.ts');
    expect(acct).toMatch(/routes\.use\('\*', customerSessionMiddleware\)/);
    expect(acct).toMatch(/private, no-store/);
    const admin = read('apps/api/src/interfaces/http/routes/admin/first-party.ts');
    for (const path of ["'/privacy-requests'", "'/privacy-requests/:id/fulfil'", "'/privacy-requests/:id/decline'"]) {
      expect(admin).toContain(`${path}, requirePermissions([PERMISSIONS.PRIVACY_REQUESTS_MANAGE])`);
    }
    const app = read('apps/api/src/interfaces/http/app.ts');
    expect(app).toMatch(/app\.route\('\/account\/privacy', accountPrivacyRoutes\)/);
    expect(PERMISSIONS.CUSTOMER_DATA_VIEW).toBe('customer_data.view');
    expect(ROLE_PERMISSION_BASELINES.SECURITY_ADMIN).toContain(PERMISSIONS.PRIVACY_REQUESTS_MANAGE);
    expect(ROLE_PERMISSION_BASELINES.ANALYST).not.toContain(PERMISSIONS.CUSTOMER_DATA_VIEW);
  });

  it('the customer page: signed-in only, confirmation required, no system state leaked, in the account menu', () => {
    const page = read('apps/web/src/pages/account/privacy.astro');
    expect(page).toContain("return Astro.redirect('/login?returnTo=/account/privacy', 303)");
    expect(page).toMatch(/name="confirm" value="yes"/);
    expect(page).toMatch(/Content-Disposition/);
    expect(page).not.toMatch(/HTTP \$\{|res\.status\}/);
    expect(read('apps/web/src/components/AccountNav.astro')).toMatch(/href: '\/account\/privacy'/);
    const admin = read('apps/web/src/pages/admin/privacy-requests.astro');
    expect(admin).toContain('readSessionToken(Astro.request)');
    expect(admin).toMatch(/Type \{r\.reference\} to confirm/);
  });
});

// ── One set of hashing rules ──────────────────────────────────────────────────
describe('audience hashing delegates to the advertising normaliser (one set of rules)', () => {
  it('every variant equals hashedContactFor for its platform, including foreign numbers', () => {
    for (const contact of [{ email: ' Jane.Doe+x@Gmail.com ', phone: '0772 123456' }, { email: 'a@b.co', phone: '+14155550100' }]) {
      const h = hashForAdPlatforms(contact);
      for (const platform of ['google_ads', 'meta', 'tiktok'] as const) expect(hashesForPlatform(h, platform)).toEqual(hashedContactFor(platform, contact));
    }
    expect(hashForAdPlatforms({ phone: '+14155550100' }).phoneSha256Digits).not.toBeNull();
    expect(googleNormalisedEmail('Jane.Doe+x@Gmail.com')).toBe('janedoe@gmail.com');
    expect(read('apps/api/src/domain/first-party/AudienceHashing.ts')).not.toMatch(/createHash/);
  });
});

// ── 0157 segment rules ────────────────────────────────────────────────────────
function customer(orders: Array<Partial<CustomerFacts['orders'][number]>>): CustomerFacts {
  return {
    canonicalCustomerId: randomUUID(), accountUserId: null, abandonedBaskets: [], bulkQuotes: [],
    orders: orders.map((o) => ({ orderId: randomUUID(), placedAt: ago(5), totalUgx: 100_000, status: 'delivered', paymentStatus: 'paid', categoryIds: [], ...o })),
  };
}

describe('segment rules: RFM segment, payment habit, district', () => {
  it('validates each new rule kind', () => {
    expect(validateSegmentDefinition({ rules: [{ kind: 'RFM_SEGMENT', segments: ['At Risk', "Can't Lose"] }] })).toMatchObject({ ok: true });
    expect(validateSegmentDefinition({ rules: [{ kind: 'RFM_SEGMENT', segments: ['Whales'] }] }).ok).toBe(false);
    expect(validateSegmentDefinition({ rules: [{ kind: 'PAYMENT_HABIT', habit: 'CASH_ON_DELIVERY' }] })).toMatchObject({ ok: true });
    expect(validateSegmentDefinition({ rules: [{ kind: 'PAYMENT_HABIT', habit: 'CARD' }] }).ok).toBe(false);
    expect(validateSegmentDefinition({ rules: [{ kind: 'DISTRICT', district: ' Wakiso ' }] })).toEqual({ ok: true, definition: { match: 'ALL', rules: [{ kind: 'DISTRICT', district: 'Wakiso' }] } });
    expect(validateSegmentDefinition({ rules: [{ kind: 'DISTRICT', district: '' }] }).ok).toBe(false);
  });

  it('evaluates habit and district from counted orders; RFM against the population', () => {
    const cod = customer([{ paymentMethod: 'offline', district: 'Wakiso' }, { paymentMethod: 'offline', district: 'Wakiso' }, { paymentMethod: 'pesapal', district: 'Kampala' }]);
    const online = customer([{ paymentMethod: 'pesapal', district: 'Kampala' }, { paymentMethod: 'offline', status: 'cancelled', district: 'Wakiso' }]);
    const def = (rules: unknown[]) => { const v = validateSegmentDefinition({ rules }); if (!v.ok) throw new Error(v.errors.join()); return v.definition; };
    expect(evaluateSegment(def([{ kind: 'PAYMENT_HABIT', habit: 'CASH_ON_DELIVERY' }]), cod, NOW)).toBe(true);
    expect(evaluateSegment(def([{ kind: 'PAYMENT_HABIT', habit: 'ONLINE' }]), online, NOW)).toBe(true);
    expect(evaluateSegment(def([{ kind: 'DISTRICT', district: 'wakiso' }]), cod, NOW)).toBe(true);
    expect(evaluateSegment(def([{ kind: 'DISTRICT', district: 'Wakiso' }]), online, NOW)).toBe(false);
    const recent = customer([{ placedAt: ago(1), totalUgx: 900_000 }, { placedAt: ago(3), totalUgx: 900_000 }, { placedAt: ago(9), totalUgx: 900_000 }, { placedAt: ago(20), totalUgx: 900_000 }]);
    const lost = customer([{ placedAt: ago(400), totalUgx: 10_000 }]);
    const members = segmentMembers(def([{ kind: 'RFM_SEGMENT', segments: ['Champions'] }]), [recent, lost, cod], NOW);
    expect(members).toEqual([recent.canonicalCustomerId]);
    expect(describeRule({ kind: 'PAYMENT_HABIT', habit: 'CASH_ON_DELIVERY' })).toBe('Usually pays cash on delivery');
  });
});
