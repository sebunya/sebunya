import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  planIdentityStitch, normalisePhoneE164, normaliseEmail, isValidFpClientId, chooseGuestAnchor, mayFoldGuestProfile,
} from '../../apps/api/src/domain/customer-dna/IdentityStitching';
import { canLinkIdentity } from '../../apps/api/src/domain/customer-dna/CustomerIdentity';
import { ResolveCustomerIdentityUseCase } from '../../apps/api/src/application/use-cases/customer-dna/CustomerDnaUseCases';
import { StitchCustomerIdentityUseCase } from '../../apps/api/src/application/use-cases/first-party/StitchCustomerIdentityUseCase';
import { ResolveIdentityConflictUseCase, ListIdentityConflictsUseCase } from '../../apps/api/src/application/use-cases/first-party/IdentityConflictUseCases';
import { HmacIdentifierHasher } from '../../apps/api/src/infrastructure/first-party/FirstPartyAdapters';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

// ── In-memory fakes behind the ports ─────────────────────────────────────────
class World {
  profiles = new Map<string, { canonicalCustomerId: string; accountUserId: string | null; mergedInto: string | null }>();
  links: any[] = [];
  conflicts: any[] = [];
  audits: any[] = [];
  accounts = new Map<string, { id: string; email: string | null; phone: string | null; phoneVerified: boolean }>();
  refused = false;
  consentThrows = false;
  anchors: any[] = [];
}

function build(w: World, pepper: string | null = 'x'.repeat(40)) {
  const profileRepo = {
    async create(input: { canonicalCustomerId?: string; accountUserId: string | null }) {
      const id = input.canonicalCustomerId ?? randomUUID();
      w.profiles.set(id, { canonicalCustomerId: id, accountUserId: input.accountUserId, mergedInto: null });
      return { canonicalCustomerId: id, accountUserId: input.accountUserId } as any;
    },
    async findByCanonicalId(id: string) { return (w.profiles.get(id) as any) ?? null; },
    async findByAccountUserId(uid: string) { return ([...w.profiles.values()].find((p) => p.accountUserId === uid && !p.mergedInto) as any) ?? null; },
    async upsertProjection() { return { updated: true, profileVersion: 1 }; },
    async search() { return []; },
  };
  const identityRepo = {
    async findByIdentifier(t: string, k: string) { return w.links.find((l) => l.signalType === t && l.identifierKey === k) ?? null; },
    async listLinks(cid: string) { return w.links.filter((l) => l.canonicalCustomerId === cid); },
    async link(input: any) {
      const existing = w.links.find((l) => l.signalType === input.signalType && l.identifierKey === input.identifierKey);
      if (existing) return { created: false, link: existing };
      const link = { id: randomUUID(), status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...input };
      w.links.push(link);
      return { created: true, link };
    },
    async setStatus(id: string, status: string) { const l = w.links.find((x) => x.id === id); if (l) l.status = status; },
    async listConflicts() { return w.links.filter((l) => l.status === 'CONFLICT'); },
  };
  const conflictRepo = {
    async record(input: any) {
      const open = w.conflicts.find((c) => c.status === 'OPEN' && c.signalType === input.signalType && c.identifierKey === input.identifierKey && c.existingCanonicalId === input.existingCanonicalId && c.proposedCanonicalId === input.proposedCanonicalId);
      if (open) { open.occurrences++; return { created: false, id: open.id }; }
      const c = { id: randomUUID(), status: 'OPEN', occurrences: 1, resolution: null, firstSeenAt: new Date(), lastSeenAt: new Date(), moment: input.moment ?? null, ...input };
      w.conflicts.push(c);
      return { created: true, id: c.id };
    },
    async listOpen() { return w.conflicts.filter((c) => c.status === 'OPEN'); },
    async findById(id: string) { return w.conflicts.find((c) => c.id === id) ?? null; },
    async markResolved(id: string, input: any) { const c = w.conflicts.find((x) => x.id === id && x.status === 'OPEN'); if (!c) return false; c.status = 'RESOLVED'; c.resolution = input.resolution; return true; },
  };
  const mergeRepo = {
    async attachAccount(cid: string, uid: string) { const p = w.profiles.get(cid); if (!p || p.accountUserId || p.mergedInto) return false; p.accountUserId = uid; return true; },
    async foldGuestInto(from: string, into: string) {
      const p = w.profiles.get(from); if (!p || p.accountUserId || p.mergedInto) return { folded: false, movedLinks: 0 };
      p.mergedInto = into;
      let moved = 0;
      for (const l of w.links) if (l.canonicalCustomerId === from) { l.canonicalCustomerId = into; l.status = 'ACTIVE'; moved++; }
      return { folded: true, movedLinks: moved };
    },
    async reassignLink(id: string, cid: string) { const l = w.links.find((x) => x.id === id); if (l) l.canonicalCustomerId = cid; },
    async profileState(cid: string) { const p = w.profiles.get(cid); return p ? { exists: true, accountUserId: p.accountUserId, mergedInto: p.mergedInto } : { exists: false, accountUserId: null, mergedInto: null }; },
    async findLink(id: string) { return w.links.find((l) => l.id === id) ?? null; },
  };
  const audit = { async save(l: any) { w.audits.push(l); }, async findAll() { return w.audits; }, async findByEntity() { return []; } };
  const accounts = { async findAccount(id: string) { return w.accounts.get(id) ?? null; } };
  const consent = { async personalisationRefused() { if (w.consentThrows) throw new Error('db down'); return w.refused; } };
  const hasher = new HmacIdentifierHasher(pepper);
  const resolveUc = new ResolveCustomerIdentityUseCase(profileRepo as any, identityRepo as any, audit as any, conflictRepo as any);
  const anchors = { async record(input: any) { if (!w.anchors.some((a) => a.canonicalCustomerId === input.canonicalCustomerId && a.fpClientId === input.fpClientId)) w.anchors.push(input); } };
  const stitch = new StitchCustomerIdentityUseCase(resolveUc, profileRepo as any, identityRepo as any, mergeRepo as any, accounts as any, hasher, consent as any, audit as any, anchors);
  const resolveConflict = new ResolveIdentityConflictUseCase(conflictRepo as any, identityRepo as any, mergeRepo as any, audit as any);
  return { stitch, resolveConflict, listConflicts: new ListIdentityConflictsUseCase(conflictRepo as any), hasher };
}

const FP = `fp.1758000000000.${randomUUID()}`;

describe('identity stitching — pure plan', () => {
  it('normalises every stored Ugandan phone shape to one E.164 and refuses the rest', () => {
    for (const raw of ['0772123456', '256772123456', '+256772123456', '772123456', '0772 123-456']) expect(normalisePhoneE164(raw)).toBe('+256772123456');
    expect(normalisePhoneE164('+14155550100')).toBeNull();
    expect(normalisePhoneE164('12345')).toBeNull();
    expect(normaliseEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
    expect(normaliseEmail('not-an-email')).toBeNull();
  });

  it('only accepts the server-minted visitor id shape', () => {
    expect(isValidFpClientId(FP)).toBe(true);
    expect(isValidFpClientId('GA1.2.123.456')).toBe(false);
    expect(isValidFpClientId('fp.1.x')).toBe(false);
  });

  it('plans account, verified proof, contacts, order and visitors in precedence order', () => {
    const account = randomUUID();
    const order = randomUUID();
    const profile = randomUUID();
    const { signals } = planIdentityStitch({
      moment: 'ORDER_PLACED', accountUserId: account, accountPhone: '0772123456', accountPhoneVerified: true,
      contactEmail: 'A@b.co', contactPhone: '+256772123456', orderId: order, experienceProfileId: profile, fpClientId: FP,
    });
    expect(signals.map((s) => s.signalType)).toEqual([
      'AUTHENTICATED_CUSTOMER_ID', 'VERIFIED_PHONE', 'CONTACT_EMAIL', 'CONTACT_PHONE', 'ORDER_CUSTOMER_RELATIONSHIP', 'STABLE_ANONYMOUS_ID', 'STABLE_ANONYMOUS_ID',
    ]);
    // the same number typed twice is ONE contact key
    expect(signals.filter((s) => s.signalType === 'CONTACT_PHONE')).toHaveLength(1);
    expect(signals.find((s) => s.signalType === 'VERIFIED_PHONE')?.mayFoldGuest).toBe(true);
    expect(signals.find((s) => s.signalType === 'CONTACT_PHONE')?.mayFoldGuest).toBe(false);
    expect(signals.find((s) => s.category === 'ORDER')?.value).toBe(`order:${order}`);
  });

  it('never creates a verified proof without an account, and never from an unverified phone', () => {
    const guest = planIdentityStitch({ moment: 'ORDER_PLACED', contactPhone: '0772123456', accountPhoneVerified: true });
    expect(guest.signals.some((s) => s.signalType === 'VERIFIED_PHONE')).toBe(false);
    const unverified = planIdentityStitch({ moment: 'SIGN_IN', accountUserId: randomUUID(), accountPhone: '0772123456', accountPhoneVerified: false });
    expect(unverified.signals.some((s) => s.signalType === 'VERIFIED_PHONE')).toBe(false);
    expect(unverified.signals.some((s) => s.signalType === 'CONTACT_PHONE')).toBe(true);
  });

  it('reports malformed inputs instead of linking them', () => {
    const r = planIdentityStitch({ moment: 'ORDER_PLACED', orderId: 'nope', fpClientId: 'x', contactPhone: '999' });
    expect(r.signals).toHaveLength(0);
    expect(r.rejected).toEqual(expect.arrayContaining(['ORDER_ID_MALFORMED', 'VISITOR_FP_MALFORMED', 'CONTACT_PHONE_NOT_UGANDAN_E164']));
  });

  it('visitor ids never anchor a guest, and only a verified proof may fold a guest profile', () => {
    expect(chooseGuestAnchor([{ category: 'VISITOR', canonicalCustomerId: 'v' }, { category: 'CONTACT', canonicalCustomerId: null }])).toBeNull();
    expect(chooseGuestAnchor([{ category: 'CONTACT', canonicalCustomerId: 'merged', merged: true }, { category: 'CONTACT', canonicalCustomerId: 'c' }])).toBe('c');
    const proof = { signalType: 'VERIFIED_PHONE' as const, category: 'VERIFIED_CONTACT' as const, value: '+256772123456', valueKind: 'PHONE' as const, mayFoldGuest: true };
    expect(mayFoldGuestProfile({ proof, guestCanonicalId: 'g', guestHasAccount: false, guestMerged: false, intoCanonicalId: 'a' })).toBe(true);
    expect(mayFoldGuestProfile({ proof, guestCanonicalId: 'g', guestHasAccount: true, guestMerged: false, intoCanonicalId: 'a' })).toBe(false);
    expect(mayFoldGuestProfile({ proof: { ...proof, mayFoldGuest: false }, guestCanonicalId: 'g', guestHasAccount: false, guestMerged: false, intoCanonicalId: 'a' })).toBe(false);
  });

  it('the new contact signals are approved and MEDIUM confidence', () => {
    expect(canLinkIdentity({ signalType: 'CONTACT_PHONE', identifierKey: 'k' })).toEqual({ ok: true, signalType: 'CONTACT_PHONE', confidence: 'MEDIUM' });
    expect(canLinkIdentity({ signalType: 'CONTACT_EMAIL', identifierKey: 'k' })).toMatchObject({ ok: true, confidence: 'MEDIUM' });
  });
});

describe('identity stitching — use case', () => {
  it('links a guest order: order, hashed contacts and visitor ids, no raw PII in any key', async () => {
    const w = new World();
    const { stitch, hasher } = build(w);
    const order = randomUUID();
    const r = await stitch.execute({ moment: 'ORDER_PLACED', orderId: order, contactPhone: '0772123456', contactEmail: 'Jane@x.ug', experienceProfileId: randomUUID(), fpClientId: FP });
    expect(r.canonicalCustomerId).toBeTruthy();
    expect(r.linked).toBe(5);
    expect(r.visitorLinks).toBe('LINKED');
    const keys = w.links.map((l) => l.identifierKey);
    expect(keys.some((k) => k.includes('0772') || k.includes('jane'))).toBe(false);
    expect(keys).toContain(hasher.hash('+256772123456'));
    expect(new Set(w.links.map((l) => l.canonicalCustomerId)).size).toBe(1);
  });

  it('a second guest order with the same phone joins the same customer, and a re-run is idempotent', async () => {
    const w = new World();
    const { stitch } = build(w);
    const a = await stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), contactPhone: '0772123456' });
    const b = await stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), contactPhone: '+256 772 123456' });
    expect(b.canonicalCustomerId).toBe(a.canonicalCustomerId);
    const again = await stitch.execute({ moment: 'BACKFILL', orderId: w.links.find((l) => l.signalType === 'ORDER_CUSTOMER_RELATIONSHIP')!.identifierKey.slice(6), contactPhone: '0772123456' });
    expect(again.linked).toBe(0);
    expect(again.idempotent).toBe(2);
    expect(w.profiles.size).toBe(1);
  });

  it('skips visitor ids when personalisation was refused, and when consent cannot be read', async () => {
    const w = new World();
    w.refused = true;
    const { stitch } = build(w);
    const r = await stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), fpClientId: FP });
    expect(r.visitorLinks).toBe('SKIPPED_PERSONALISATION_REFUSED');
    expect(w.links.some((l) => l.signalType === 'STABLE_ANONYMOUS_ID')).toBe(false);
    const w2 = new World();
    w2.consentThrows = true;
    const r2 = await build(w2).stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), fpClientId: FP });
    expect(r2.visitorLinks).toBe('SKIPPED_CONSENT_UNREADABLE');
    expect(w2.links.some((l) => l.signalType === 'STABLE_ANONYMOUS_ID')).toBe(false);
  });

  it('0157: a refused (or unreadable) browser is kept as a CONSENT ANCHOR, so a guest\'s refusal still reaches audiences', async () => {
    const w = new World();
    w.refused = true;
    const r = await build(w).stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), contactPhone: '0772123456', fpClientId: FP });
    expect(r.canonicalCustomerId).toBeTruthy();
    expect(w.anchors).toEqual([{ canonicalCustomerId: r.canonicalCustomerId, fpClientId: FP, reason: 'PERSONALISATION_REFUSED' }]);
    // …and never as a behaviour link
    expect(w.links.some((l) => l.identifierKey === `fp:${FP}`)).toBe(false);

    const w2 = new World();
    w2.consentThrows = true;
    const r2 = await build(w2).stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), fpClientId: FP });
    expect(w2.anchors[0]).toMatchObject({ canonicalCustomerId: r2.canonicalCustomerId, reason: 'CONSENT_UNREADABLE' });

    // Allowed browsers are behaviour links, not anchors.
    const w3 = new World();
    await build(w3).stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), fpClientId: FP });
    expect(w3.anchors).toEqual([]);
    expect(w3.links.some((l) => l.identifierKey === `fp:${FP}`)).toBe(true);
  });

  it('0157: verifying a phone stitches at once, so the verified number folds that person\'s guest orders', async () => {
    expect(read('apps/api/src/interfaces/http/routes/account.ts')).toMatch(/stitchInBackground\(\{ moment: 'PHONE_VERIFIED', accountUserId: userId \}\)/);
    const w = new World();
    const { stitch } = build(w);
    const guest = await stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), contactPhone: '0772123456' });
    const account = randomUUID();
    w.accounts.set(account, { id: account, email: 'a@b.co', phone: '+256772123456', phoneVerified: true });
    const r = await stitch.execute({ moment: 'PHONE_VERIFIED', accountUserId: account });
    expect(r.canonicalCustomerId).toBe(guest.canonicalCustomerId); // the guest profile was claimed by the account
    expect(r.claimedGuest).toBe(true);
    expect(w.conflicts).toHaveLength(0);
  });

  it('0157: the audience contact reader includes consent-anchor browsers (refusal check covers guests)', () => {
    const src = read('apps/api/src/infrastructure/first-party/DrizzleCustomerFactsReader.ts');
    expect(src).toMatch(/customerConsentAnchors/);
    expect(src).toMatch(/anchors\.filter\(\(a\) => a\.canonical === p\.id\)/);
    // …and so does the advertising module's per-order refusal lookup (offline conversions, buyer audiences).
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleAdvertisingOpsRepository.ts')).toMatch(/from customer_consent_anchors/);
  });

  it('without a hashing secret, contacts are skipped (never stored raw) but the order still links', async () => {
    const w = new World();
    const { stitch } = build(w, null);
    const r = await stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), contactPhone: '0772123456' });
    expect(r.skipped).toContain('HASHING_NOT_CONFIGURED_CONTACT_PHONE');
    expect(w.links.map((l) => l.signalType)).toEqual(['ORDER_CUSTOMER_RELATIONSHIP']);
  });

  it('registration with an UNVERIFIED phone a guest used is a CONFLICT for review, never a merge', async () => {
    const w = new World();
    const { stitch, listConflicts } = build(w);
    const guest = await stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), contactPhone: '0772123456' });
    const uid = randomUUID();
    w.accounts.set(uid, { id: uid, email: 'new@x.ug', phone: '0772123456', phoneVerified: false });
    const reg = await stitch.execute({ moment: 'REGISTRATION', accountUserId: uid });
    expect(reg.canonicalCustomerId).not.toBe(guest.canonicalCustomerId);
    expect(reg.conflicts).toBe(1);
    expect(reg.foldedGuests).toBe(0);
    expect(w.profiles.get(guest.canonicalCustomerId!)!.mergedInto).toBeNull();
    const open = await listConflicts.execute();
    expect(open).toHaveLength(1);
    expect(open[0].identifierMasked).toMatch(/…/);
    expect((open[0] as any).identifierKey).toBeUndefined();
    // the same clash again is ONE conflict with a higher count, and ONE audit line
    const auditsBefore = w.audits.filter((a) => a.action === 'CUSTOMER_IDENTITY_CONFLICT').length;
    await stitch.execute({ moment: 'SIGN_IN', accountUserId: uid });
    expect(w.conflicts).toHaveLength(1);
    expect(w.conflicts[0].occurrences).toBe(2);
    expect(w.audits.filter((a) => a.action === 'CUSTOMER_IDENTITY_CONFLICT').length).toBe(auditsBefore);
  });

  it('a VERIFIED phone lets a new account adopt the guest profile that ordered with it', async () => {
    const w = new World();
    const { stitch } = build(w);
    const guest = await stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), contactPhone: '0772123456' });
    // A verified-phone link from elsewhere pointing at the guest makes it claimable.
    const uid = randomUUID();
    w.accounts.set(uid, { id: uid, email: 'v@x.ug', phone: '+256772123456', phoneVerified: true });
    const r = await stitch.execute({ moment: 'SIGN_IN', accountUserId: uid });
    expect(r.claimedGuest).toBe(true);
    expect(r.canonicalCustomerId).toBe(guest.canonicalCustomerId);
    expect(w.profiles.get(guest.canonicalCustomerId!)!.accountUserId).toBe(uid);
    expect(r.conflicts).toBe(0);
    expect(w.audits.some((a) => a.action === 'CUSTOMER_PROFILE_CLAIMED_BY_ACCOUNT' && a.actorId === null)).toBe(true);
  });

  it('a VERIFIED phone folds a guest profile into an account that already has one', async () => {
    const w = new World();
    const { stitch } = build(w);
    const uid = randomUUID();
    w.accounts.set(uid, { id: uid, email: 'v@x.ug', phone: '0772123456', phoneVerified: false });
    const acct = await stitch.execute({ moment: 'REGISTRATION', accountUserId: uid });
    const guest = await stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), contactEmail: 'guest@x.ug', contactPhone: '0700000001' });
    // the guest later checks out with the account's number → CONTACT_PHONE clash
    w.accounts.set(uid, { id: uid, email: 'v@x.ug', phone: '0700000001', phoneVerified: true });
    const r = await stitch.execute({ moment: 'SIGN_IN', accountUserId: uid });
    expect(r.foldedGuests).toBe(1);
    expect(w.profiles.get(guest.canonicalCustomerId!)!.mergedInto).toBe(acct.canonicalCustomerId);
    expect(w.links.filter((l) => l.canonicalCustomerId === guest.canonicalCustomerId)).toHaveLength(0);
  });

  it('an account profile is never folded, even on a verified proof', async () => {
    const w = new World();
    const { stitch } = build(w);
    const a = randomUUID();
    const b = randomUUID();
    w.accounts.set(a, { id: a, email: 'a@x.ug', phone: '0772123456', phoneVerified: false });
    await stitch.execute({ moment: 'REGISTRATION', accountUserId: a });
    w.accounts.set(b, { id: b, email: 'b@x.ug', phone: '0772123456', phoneVerified: true });
    const r = await stitch.execute({ moment: 'SIGN_IN', accountUserId: b });
    expect(r.foldedGuests).toBe(0);
    expect(r.conflicts).toBeGreaterThan(0);
    expect([...w.profiles.values()].every((p) => p.mergedInto === null)).toBe(true);
  });
});

describe('identity conflicts — a person resolves them', () => {
  async function withConflict() {
    const w = new World();
    const built = build(w);
    const guest = await built.stitch.execute({ moment: 'ORDER_PLACED', orderId: randomUUID(), contactPhone: '0772123456' });
    const uid = randomUUID();
    w.accounts.set(uid, { id: uid, email: 'n@x.ug', phone: '0772123456', phoneVerified: false });
    const acct = await built.stitch.execute({ moment: 'REGISTRATION', accountUserId: uid });
    return { w, ...built, guest: guest.canonicalCustomerId!, acct: acct.canonicalCustomerId!, conflictId: w.conflicts[0].id as string };
  }

  it('requires a known resolution and a reason', async () => {
    const { resolveConflict, conflictId } = await withConflict();
    expect(await resolveConflict.execute({ conflictId, resolution: 'AUTO', reason: 'because', actorId: randomUUID() })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await resolveConflict.execute({ conflictId, resolution: 'KEEP_EXISTING', reason: 'no', actorId: randomUUID() })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
  });

  it('MERGE_GUEST_INTO_PROPOSED folds the guest and cannot be applied twice', async () => {
    const { w, resolveConflict, conflictId, guest, acct } = await withConflict();
    const actor = randomUUID();
    const r = await resolveConflict.execute({ conflictId, resolution: 'MERGE_GUEST_INTO_PROPOSED', reason: 'customer confirmed by phone call', actorId: actor });
    expect(r.ok).toBe(true);
    expect(w.profiles.get(guest)!.mergedInto).toBe(acct);
    expect(w.audits.some((a) => a.action === 'CUSTOMER_IDENTITY_CONFLICT_RESOLVED' && a.actorId === actor)).toBe(true);
    expect(await resolveConflict.execute({ conflictId, resolution: 'KEEP_EXISTING', reason: 'second try', actorId: actor })).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED' });
  });

  it('DETACH splits the link so it belongs to neither', async () => {
    const { w, resolveConflict, conflictId } = await withConflict();
    await resolveConflict.execute({ conflictId, resolution: 'DETACH', reason: 'shared family phone', actorId: randomUUID() });
    const link = w.links.find((l) => l.id === w.conflicts[0].linkId);
    expect(link.status).toBe('SPLIT');
  });
});

describe('identity stitching is switched on at the right moments (wiring)', () => {
  it('sign-in, registration, social sign-in, the login merge and order placement all stitch', () => {
    expect(read('apps/api/src/interfaces/http/routes/auth.ts')).toMatch(/stitchInBackground\(\{ moment: 'SIGN_IN'/);
    expect(read('apps/api/src/interfaces/http/routes/auth.ts')).toMatch(/stitchInBackground\(\{ moment: 'REGISTRATION'/);
    expect(read('apps/api/src/interfaces/http/routes/auth-social.ts')).toMatch(/moment: 'SOCIAL_SIGN_IN'/);
    expect(read('apps/api/src/interfaces/http/routes/recommendations.ts')).toMatch(/moment: 'VISITOR_LINK'/);
    const commerce = read('apps/api/src/interfaces/http/routes/commerce.ts');
    expect(commerce).toMatch(/moment: 'ORDER_PLACED'/);
    expect(commerce).toMatch(/!outcome\.idempotentReplay/);
    for (const page of ['apps/web/src/pages/login.astro', 'apps/web/src/pages/register.astro']) expect(read(page)).toMatch(/'x-gp-fpcid'/);
  });

  it('stitching can never fail the caller: fire-and-forget, off in tests, with a rollback switch', () => {
    const src = read('apps/api/src/infrastructure/first-party/stitchInBackground.ts');
    expect(src).toMatch(/NODE_ENV === 'test'/);
    expect(src).toMatch(/IDENTITY_STITCHING/);
    expect(src).toMatch(/\.catch\(/);
  });
});
