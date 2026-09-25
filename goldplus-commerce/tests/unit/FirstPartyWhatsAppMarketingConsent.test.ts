import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WHATSAPP_MARKETING_COPY_VERSION, WHATSAPP_MARKETING_PURPOSE, planWhatsAppMarketingChange, mayReceiveWhatsAppMarketing,
  mayReceiveWhatsAppMessage, whatsappMarketingStatus, whatsappMarketingCopyHash,
} from '../../apps/api/src/domain/consent/WhatsAppMarketingConsent';
import { WhatsAppMarketingConsentUseCases } from '../../apps/api/src/application/use-cases/first-party/WhatsAppMarketingConsentUseCases';
import { CONSENT_PURPOSE_KEYS } from '../../apps/api/src/application/ports/consent/ConsentOperatingRepository';
import { HmacIdentifierHasher } from '../../apps/api/src/infrastructure/first-party/FirstPartyAdapters';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('WhatsApp marketing consent — domain', () => {
  it('is a distinct purpose in the consent taxonomy', () => {
    expect(CONSENT_PURPOSE_KEYS).toContain(WHATSAPP_MARKETING_PURPOSE);
    expect(WHATSAPP_MARKETING_PURPOSE).not.toBe('marketing_offers_campaigns');
  });

  it('is OFF by default: no record, unknown or a generic grant elsewhere is not an opt-in', () => {
    expect(whatsappMarketingStatus(null)).toBe('NOT_OPTED_IN');
    expect(whatsappMarketingStatus('unknown')).toBe('NOT_OPTED_IN');
    expect(whatsappMarketingStatus('pending_verification')).toBe('NOT_OPTED_IN');
    expect(mayReceiveWhatsAppMarketing({ state: null, consentedPhoneHash: 'h', currentPhoneHash: 'h' }).allowed).toBe(false);
  });

  it('a grant needs the ticked box, the current wording, a signed-in account and a phone', () => {
    const base = { current: null, requested: 'granted' as const, confirmationTicked: true, copyVersionId: WHATSAPP_MARKETING_COPY_VERSION, signedInAccount: true, phoneE164: '+256772123456' };
    expect(planWhatsAppMarketingChange(base)).toMatchObject({ ok: true, next: 'granted' });
    expect(planWhatsAppMarketingChange({ ...base, confirmationTicked: false })).toEqual({ ok: false, reason: 'CONFIRMATION_REQUIRED' });
    expect(planWhatsAppMarketingChange({ ...base, copyVersionId: 'old' })).toEqual({ ok: false, reason: 'COPY_VERSION_MISMATCH' });
    expect(planWhatsAppMarketingChange({ ...base, signedInAccount: false })).toEqual({ ok: false, reason: 'SIGNED_IN_ACCOUNT_REQUIRED' });
    expect(planWhatsAppMarketingChange({ ...base, phoneE164: null })).toEqual({ ok: false, reason: 'PHONE_REQUIRED' });
    expect(planWhatsAppMarketingChange({ ...base, current: 'blocked_by_policy' })).toEqual({ ok: false, reason: 'BLOCKED_BY_POLICY' });
    // a withdrawal always succeeds — saying no is never harder than saying yes
    expect(planWhatsAppMarketingChange({ ...base, requested: 'withdrawn', confirmationTicked: false, signedInAccount: false, phoneE164: null })).toMatchObject({ ok: true, next: 'withdrawn' });
  });

  it('covers the number it was given for; a changed phone is not opted in', () => {
    expect(mayReceiveWhatsAppMarketing({ state: 'granted', consentedPhoneHash: 'a', currentPhoneHash: 'a' })).toEqual({ allowed: true, reason: 'OPTED_IN' });
    expect(mayReceiveWhatsAppMarketing({ state: 'granted', consentedPhoneHash: 'a', currentPhoneHash: 'b' })).toEqual({ allowed: false, reason: 'PHONE_CHANGED_SINCE_OPT_IN' });
    expect(mayReceiveWhatsAppMarketing({ state: 'granted', consentedPhoneHash: null, currentPhoneHash: 'b' })).toEqual({ allowed: false, reason: 'NO_OPT_IN_EVIDENCE' });
  });

  it('transactional WhatsApp is never gated by the marketing purpose', () => {
    const refused = { allowed: false, reason: 'NOT_OPTED_IN' };
    expect(mayReceiveWhatsAppMessage({ category: 'TRANSACTIONAL', marketing: refused }).allowed).toBe(true);
    expect(mayReceiveWhatsAppMessage({ category: 'MARKETING', marketing: refused }).allowed).toBe(false);
  });

  it('the copy version row in 0155 carries the hash of the exact words shown', () => {
    const migration = read('apps/api/src/infrastructure/db/migrations/0155_first_party_data.sql');
    expect(migration).toContain(`'${WHATSAPP_MARKETING_COPY_VERSION}', 'whatsapp_marketing', 'whatsapp'`);
    expect(migration).toContain(whatsappMarketingCopyHash());
    expect(migration).toMatch(/customer_consent_states_whatsapp_marketing_verified_chk/);
  });
});

describe('WhatsApp marketing consent — use case records evidence', () => {
  function setup(phone: string | null = '0772123456') {
    const uid = randomUUID();
    const states = new Map<string, any>();
    const events: any[] = [];
    const evidence: any[] = [];
    const consent = {
      async getLatestConsentState(k: any) { return states.get(`${k.customer_identity_ref}|${k.purpose_key}|${k.channel_key}`) ?? null; },
      async commitStateChange(e: any) {
        const dup = events.find((x) => x.consent_event_id === e.consent_event_id);
        if (dup) return { consent_event_id: dup.consent_event_id, state: dup.new_state, already_applied: true };
        events.push(e);
        states.set(`${e.customer_identity_ref}|${e.purpose_key}|${e.channel_key}`, { state: e.new_state, last_consent_event_id: e.consent_event_id, effective_at: e.effective_at });
        return { consent_event_id: e.consent_event_id, state: e.new_state, already_applied: false };
      },
    };
    const evidenceRepo = {
      async record(i: any) { evidence.push(i); },
      async latestFor(id: string) { const e = evidence.find((x) => x.consentEventId === id); return e ? { endpointHash: e.endpointHash, capturedAt: new Date() } : null; },
    };
    const account = { id: uid, email: 'a@b.ug', phone, phoneVerified: false };
    const accounts = { async findAccount(id: string) { return id === uid ? account : null; } };
    const hasher = new HmacIdentifierHasher('p'.repeat(40));
    const uc = new WhatsAppMarketingConsentUseCases(consent as any, evidenceRepo as any, accounts as any, hasher);
    return { uid, uc, events, evidence, account, hasher };
  }
  const req = (over: Record<string, unknown> = {}) => ({ requested: 'granted' as const, confirmationTicked: true, copyVersionId: WHATSAPP_MARKETING_COPY_VERSION, idempotencyKey: randomUUID(), correlationId: randomUUID(), ipAddress: '41.210.1.1', userAgent: 'Mozilla/5.0', ...over });

  it('starts off, and an opt-in writes one consent event plus hashed evidence', async () => {
    const { uid, uc, events, evidence, hasher } = setup();
    expect((await uc.status(uid)).status).toBe('NOT_OPTED_IN');
    const r = await uc.change({ userId: uid, ...req() });
    expect(r).toMatchObject({ ok: true, status: 'OPTED_IN' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ purpose_key: 'whatsapp_marketing', channel_key: 'whatsapp', identity_level: 'verified_account', actor_type: 'customer', copy_version_id: WHATSAPP_MARKETING_COPY_VERSION });
    expect(evidence[0]).toMatchObject({ confirmation: 'CHECKBOX_TICKED', copyTextHash: whatsappMarketingCopyHash(), endpointHash: hasher.hash('+256772123456'), endpointMasked: '+256•••••3456' });
    expect(JSON.stringify(evidence)).not.toMatch(/41\.210|Mozilla|0772123456/);
    const s = await uc.status(uid);
    expect(s).toMatchObject({ status: 'OPTED_IN', covered: true });
    expect((await uc.mayMarket(uid))).toMatchObject({ allowed: true, phoneE164: '+256772123456' });
  });

  it('a double-submitted form is one event', async () => {
    const { uid, uc, events } = setup();
    const r = req();
    await uc.change({ userId: uid, ...r });
    const again = await uc.change({ userId: uid, ...r, requested: 'granted' });
    expect(again).toMatchObject({ ok: true, alreadyApplied: true });
    expect(events).toHaveLength(1);
  });

  it('an unticked box records nothing', async () => {
    const { uid, uc, events } = setup();
    expect(await uc.change({ userId: uid, ...req({ confirmationTicked: false }) })).toMatchObject({ ok: false, code: 'CONFIRMATION_REQUIRED' });
    expect(events).toHaveLength(0);
  });

  it('withdrawal stops marketing; a changed number is not covered by an old opt-in', async () => {
    const { uid, uc, account } = setup();
    await uc.change({ userId: uid, ...req() });
    account.phone = '0700000001';
    expect(await uc.mayMarket(uid)).toMatchObject({ allowed: false, reason: 'PHONE_CHANGED_SINCE_OPT_IN', phoneE164: null });
    await uc.change({ userId: uid, ...req({ requested: 'withdrawn', confirmationTicked: false }) });
    expect((await uc.status(uid)).status).toBe('WITHDRAWN');
    expect((await uc.mayMarket(uid)).allowed).toBe(false);
  });

  it('an account without a phone cannot opt in', async () => {
    const { uid, uc } = setup(null);
    expect(await uc.change({ userId: uid, ...req() })).toMatchObject({ ok: false, code: 'PHONE_REQUIRED' });
  });
});

describe('WhatsApp marketing consent — preference centre and API wiring', () => {
  it('the preference page shows its own off-by-default section, with an unticked box', () => {
    const page = read('apps/web/src/pages/account/preferences.astro');
    expect(page).toMatch(/<WhatsAppMarketingConsentForm status=\{whatsappMarketing\} \/>/);
    expect(page).toMatch(/do not switch on marketing messages/i);
    const form = read('apps/web/src/components/preferences/WhatsAppMarketingConsentForm.astro');
    expect(form).toMatch(/type="checkbox" name="confirmation" value="yes" required/);
    expect(form).not.toMatch(/\bchecked\b/);
    expect(form).toMatch(/not affected by what you choose here/);
    expect(form).not.toMatch(/\son[a-z]+=/);
    // an unreadable state is never shown as "off"
    expect(form).toMatch(/nothing is shown as on or off/);
  });

  it('the API route is mounted and forwards the evidence context', () => {
    const app = read('apps/api/src/interfaces/http/app.ts');
    expect(app).toMatch(/app\.route\('\/account\/marketing-consent', accountMarketingConsentRoutes\)/);
    expect(app).toMatch(/'\/admin\/first-party',/);
    expect(read('apps/api/src/interfaces/http/routes/account-marketing-consent.ts')).toMatch(/customerSessionMiddleware/);
  });

  it('this module did not touch the WhatsApp notification adapters or message classification', () => {
    for (const f of ['WhatsAppMarketingConsentUseCases.ts', 'SegmentAudienceService.ts', 'StitchCustomerIdentityUseCase.ts']) {
      const src = read(`apps/api/src/application/use-cases/first-party/${f}`);
      expect(src).not.toMatch(/notifications\/|OutboundGovernanceService|messageClassification/);
    }
  });
});
