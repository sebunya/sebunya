import {
  StitchFacts, StitchMoment, PlannedSignal, planIdentityStitch, counterpartOf, chooseGuestAnchor, mayFoldGuestProfile, AnchorCandidate, isValidFpClientId,
} from '../../../domain/customer-dna/IdentityStitching';
import type { ICustomerIdentityRepository, ICustomerProfileRepository } from '../../ports/ICustomerDnaRepository';
import type {
  IAccountIdentityReader, IConsentAnchorRepository, IIdentifierHasher, IIdentityMergeRepository, IPersonalisationConsentReader,
} from '../../ports/first-party/FirstPartyPorts';
import type { ResolveCustomerIdentityUseCase } from '../customer-dna/CustomerDnaUseCases';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export interface StitchInput {
  moment: StitchMoment;
  accountUserId?: string | null;
  /** Social sign-in: the provider verified this email. */
  accountEmailVerified?: boolean;
  contactEmail?: string | null;
  contactPhone?: string | null;
  orderId?: string | null;
  experienceProfileId?: string | null;
  fpClientId?: string | null;
}

export interface StitchResult {
  ok: true;
  canonicalCustomerId: string | null;
  linked: number;
  idempotent: number;
  conflicts: number;
  foldedGuests: number;
  claimedGuest: boolean;
  visitorLinks: 'LINKED' | 'SKIPPED_PERSONALISATION_REFUSED' | 'SKIPPED_CONSENT_UNREADABLE' | 'NONE';
  skipped: string[];
}

const ACTOR = 'system:identity-stitch';

/**
 * Switches ON customer identity resolution (owner approved): links a customer
 * to their account, contacts, orders and visitor ids at sign-in, registration,
 * checkout and order placement. Wraps ResolveCustomerIdentityUseCase, which
 * owns idempotency and CONFLICT detection; this use case chooses the anchor,
 * folds a guest profile only on verified proof, and keeps visitor ids inside
 * the personalisation consent rule. Best-effort by design — callers never let
 * it fail a sign-in or an order.
 */
export class StitchCustomerIdentityUseCase {
  constructor(
    private readonly resolve: ResolveCustomerIdentityUseCase,
    private readonly profiles: ICustomerProfileRepository,
    private readonly identities: ICustomerIdentityRepository,
    private readonly merges: IIdentityMergeRepository,
    private readonly accounts: IAccountIdentityReader,
    private readonly hasher: IIdentifierHasher,
    private readonly consent: IPersonalisationConsentReader,
    private readonly audit: IAuditRepository,
    /**
     * 0157: when a browser may NOT be linked as behaviour (personalisation
     * refused, or unreadable), it is still recorded as a consent anchor so a
     * refusal stored on it keeps this customer out of audiences and messaging.
     */
    private readonly anchors?: IConsentAnchorRepository,
  ) {}

  async execute(input: StitchInput): Promise<StitchResult> {
    const result: StitchResult = { ok: true, canonicalCustomerId: null, linked: 0, idempotent: 0, conflicts: 0, foldedGuests: 0, claimedGuest: false, visitorLinks: 'NONE', skipped: [] };

    const account = input.accountUserId ? await this.accounts.findAccount(input.accountUserId) : null;
    if (input.accountUserId && !account) result.skipped.push('ACCOUNT_NOT_FOUND');

    const facts: StitchFacts = {
      moment: input.moment,
      accountUserId: account?.id ?? null,
      accountEmail: account?.email ?? null,
      accountEmailVerified: input.accountEmailVerified === true,
      accountPhone: account?.phone ?? null,
      accountPhoneVerified: account?.phoneVerified === true,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      orderId: input.orderId ?? null,
      experienceProfileId: input.experienceProfileId ?? null,
      fpClientId: input.fpClientId ?? null,
    };
    const plan = planIdentityStitch(facts);
    result.skipped.push(...plan.rejected);

    // Visitor ids are behavioural: linked only when personalisation is not
    // refused. An unreadable consent state links none (fail closed).
    const hasVisitor = plan.signals.some((s) => s.category === 'VISITOR');
    let visitorAllowed = false;
    if (hasVisitor) {
      try {
        visitorAllowed = !(await this.consent.personalisationRefused({ userId: facts.accountUserId, fpClientId: facts.fpClientId }));
        result.visitorLinks = visitorAllowed ? 'LINKED' : 'SKIPPED_PERSONALISATION_REFUSED';
      } catch {
        result.visitorLinks = 'SKIPPED_CONSENT_UNREADABLE';
      }
    }

    const keyed: Array<PlannedSignal & { key: string }> = [];
    for (const s of plan.signals) {
      if (s.category === 'VISITOR' && !visitorAllowed) continue;
      const key = s.valueKind === 'RAW_KEY' ? s.value : this.hasher.hash(s.value);
      if (!key) { result.skipped.push(`HASHING_NOT_CONFIGURED_${s.signalType}`); continue; }
      keyed.push({ ...s, key });
    }
    if (keyed.length === 0) {
      // Only a refused browser and nothing that names a customer: no profile to anchor it to.
      return result;
    }

    // ── The anchor: the account's profile, else a guest's existing owner. ──
    let anchor: string | null = null;
    if (facts.accountUserId) {
      anchor = (await this.profiles.findByAccountUserId(facts.accountUserId))?.canonicalCustomerId ?? null;
      if (!anchor) anchor = await this.claimGuestProfile(facts.accountUserId, keyed, result);
    } else {
      const candidates: AnchorCandidate[] = [];
      for (const s of keyed) {
        if (s.category === 'VISITOR') continue;
        const existing = await this.identities.findByIdentifier(s.signalType, s.key);
        const state = existing ? await this.merges.profileState(existing.canonicalCustomerId) : null;
        candidates.push({ category: s.category, canonicalCustomerId: existing?.canonicalCustomerId ?? null, merged: !!state?.mergedInto });
      }
      anchor = chooseGuestAnchor(candidates);
    }

    for (const s of keyed) {
      if (anchor && s.mayFoldGuest) await this.foldGuestsProvenBy(s, anchor, result);
      const r = await this.resolve.execute({
        signalType: s.signalType,
        identifierKey: s.key,
        accountUserId: facts.accountUserId,
        proposedCanonicalCustomerId: anchor,
        actorId: ACTOR,
        moment: input.moment,
      });
      if (!r.ok) { result.skipped.push(`${s.signalType}:${r.code}`); continue; }
      if (!anchor) anchor = r.canonicalCustomerId;
      if (r.outcome === 'CREATE') result.linked++;
      else if (r.outcome === 'IDEMPOTENT') result.idempotent++;
      else result.conflicts++;
    }
    result.canonicalCustomerId = anchor;
    await this.recordConsentAnchor(anchor, facts.fpClientId ?? null, result);
    return result;
  }

  private async recordConsentAnchor(canonicalCustomerId: string | null, fpClientId: string | null, result: StitchResult): Promise<void> {
    if (!this.anchors || !canonicalCustomerId || !fpClientId || !isValidFpClientId(fpClientId)) return;
    if (result.visitorLinks !== 'SKIPPED_PERSONALISATION_REFUSED' && result.visitorLinks !== 'SKIPPED_CONSENT_UNREADABLE') return;
    try {
      await this.anchors.record({
        canonicalCustomerId, fpClientId,
        reason: result.visitorLinks === 'SKIPPED_PERSONALISATION_REFUSED' ? 'PERSONALISATION_REFUSED' : 'CONSENT_UNREADABLE',
      });
    } catch {
      result.skipped.push('CONSENT_ANCHOR_NOT_RECORDED');
    }
  }

  /**
   * An account with no profile yet may ADOPT a guest profile — only when a
   * verified proof of this account points at it, and every such proof agrees.
   */
  private async claimGuestProfile(accountUserId: string, keyed: Array<PlannedSignal & { key: string }>, result: StitchResult): Promise<string | null> {
    const owners = new Set<string>();
    for (const s of keyed.filter((k) => k.mayFoldGuest)) {
      const counterpart = counterpartOf(s.signalType);
      for (const type of [s.signalType, counterpart]) {
        if (!type) continue;
        const existing = await this.identities.findByIdentifier(type, s.key);
        if (existing && existing.status === 'ACTIVE') owners.add(existing.canonicalCustomerId);
      }
    }
    if (owners.size !== 1) return null;
    const [candidate] = [...owners];
    const state = await this.merges.profileState(candidate);
    if (!state.exists || state.accountUserId || state.mergedInto) return null;
    if (!(await this.merges.attachAccount(candidate, accountUserId))) return null;
    result.claimedGuest = true;
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: null, action: 'CUSTOMER_PROFILE_CLAIMED_BY_ACCOUNT', entity: 'customer_profile', entityId: candidate,
      newState: { accountUserId, proof: 'VERIFIED_CONTACT' },
    });
    return candidate;
  }

  /** A verified proof folds GUEST profiles holding the same contact into the anchor. */
  private async foldGuestsProvenBy(proof: PlannedSignal & { key: string }, anchor: string, result: StitchResult): Promise<void> {
    const counterpart = counterpartOf(proof.signalType);
    if (!counterpart) return;
    const existing = await this.identities.findByIdentifier(counterpart, proof.key);
    if (!existing || existing.canonicalCustomerId === anchor) return;
    const state = await this.merges.profileState(existing.canonicalCustomerId);
    if (!state.exists) return;
    const ok = mayFoldGuestProfile({ proof, guestCanonicalId: existing.canonicalCustomerId, guestHasAccount: !!state.accountUserId, guestMerged: !!state.mergedInto, intoCanonicalId: anchor });
    if (!ok) return;
    const folded = await this.merges.foldGuestInto(existing.canonicalCustomerId, anchor);
    if (!folded.folded) return;
    result.foldedGuests++;
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: null, action: 'CUSTOMER_PROFILE_FOLDED', entity: 'customer_profile', entityId: existing.canonicalCustomerId,
      newState: { into: anchor, proof: proof.signalType, movedLinks: folded.movedLinks },
    });
  }
}
