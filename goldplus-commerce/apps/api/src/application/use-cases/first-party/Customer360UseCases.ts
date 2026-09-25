import { buildCustomerTimeline, describeLink, maskKey } from '../../../domain/first-party/Customer360';
import { computeCustomerTraits, rfmForPopulation, valueOf } from '../../../domain/first-party/CustomerTraits';
import type { RfmScore } from '../../../domain/customer-dna/Rfm';
import type { ICustomer360Reader, ICustomerFactsReader } from '../../ports/first-party/FirstPartyPorts';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

type Fail = { ok: false; code: string; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Audit a profile view. Shared by the 360 and the Customer DNA detail. Throws if the audit cannot be written. */
export async function auditProfileView(audit: IAuditRepository, input: { viewerId: string; canonicalCustomerId: string; surface: string; reason?: string | null }): Promise<void> {
  const r = await new CreateAuditLogUseCase(audit).execute({
    actorId: UUID.test(input.viewerId) ? input.viewerId : null,
    action: 'CUSTOMER_PROFILE_VIEWED',
    entity: 'customer_profile',
    entityId: input.canonicalCustomerId,
    newState: { surface: input.surface, reason: input.reason?.trim().slice(0, 200) || null },
  });
  if (!r.ok) throw new Error('PROFILE_VIEW_AUDIT_FAILED');
}

/**
 * The admin Customer 360 (0157): ONE unified profile — identity, a timeline,
 * value, traits, segments, consents and attribution — from the authoritative
 * records. Every view is audited BEFORE the data is returned; if the audit row
 * cannot be written, nothing is shown (a view that leaves no trace is exactly
 * what the audit exists to prevent). Identifier keys are masked here, on the
 * server. Contact details are shown: the route requires customer_data.view.
 */
export class GetCustomer360UseCase {
  constructor(
    private readonly reader: ICustomer360Reader,
    private readonly facts: ICustomerFactsReader,
    private readonly audit: IAuditRepository,
  ) {}

  /** Audit a view of the Customer DNA detail (the other surface that shows one profile). false = not recorded, do not show. */
  async recordView(input: { canonicalCustomerId: string; viewerId: string; surface: string }): Promise<boolean> {
    if (!UUID.test(input.canonicalCustomerId)) return false;
    return auditProfileView(this.audit, input).then(() => true, () => false);
  }

  async canonicalForAccount(accountUserId: string): Promise<string | null> {
    return UUID.test(accountUserId) ? this.reader.canonicalForAccount(accountUserId) : null;
  }

  async execute(input: { canonicalCustomerId: string; viewerId: string; reason?: string | null; now?: Date }) {
    if (!UUID.test(input.canonicalCustomerId)) return { ok: false, code: 'NOT_FOUND', message: 'Customer profile not found.' } satisfies Fail;
    const now = input.now ?? new Date();
    const records = await this.reader.read(input.canonicalCustomerId);
    if (!records) return { ok: false, code: 'NOT_FOUND', message: 'Customer profile not found.' } satisfies Fail;
    try {
      await auditProfileView(this.audit, { viewerId: input.viewerId, canonicalCustomerId: input.canonicalCustomerId, surface: 'customer_360', reason: input.reason });
    } catch {
      return { ok: false, code: 'AUDIT_UNAVAILABLE', message: 'This profile cannot be shown right now because the view could not be recorded. Try again shortly.' } satisfies Fail;
    }

    // RFM is relative to everyone who has ordered; if the population cannot be
    // read the score is absent (said so), never guessed.
    let rfm: (RfmScore & { population: number }) | null = null;
    let rfmNote: string | null = null;
    try {
      rfm = rfmForPopulation(await this.facts.readAll(now), now).get(input.canonicalCustomerId) ?? null;
    } catch {
      rfmNote = 'The RFM population could not be read, so no score is shown.';
    }

    const optedInChannels = records.consents.purposes
      .filter((p) => p.state === 'granted' && (p.purposeKey === 'whatsapp_marketing' || p.purposeKey === 'marketing_offers_campaigns'))
      .map((p) => p.channelKey);
    const traits = computeCustomerTraits({
      canonicalCustomerId: input.canonicalCustomerId,
      orders: records.orders,
      categoryViews: records.categoryViews,
      devices: records.devices,
      // A bulk quote is a BQ- reference (0153); a legacy single-product enquiry is not bulk.
      bulkQuotes: records.quotes.filter((q) => q.reference?.startsWith('BQ-')).map((q) => ({ reference: q.reference as string, createdAt: q.createdAt, lineCount: q.lineCount, totalUnits: q.totalUnits })),
      addressDistricts: records.addressDistricts,
      optedInChannels: [...new Set(optedInChannels)],
      finderAnswers: records.finderSessions.map((f) => ({ at: f.at, answers: f.answers })),
    }, rfm, now);
    if (rfmNote) traits.rfm = { ...traits.rfm, value: null, evidence: rfmNote };

    return {
      ok: true as const,
      generatedAt: now.toISOString(),
      identity: {
        canonicalCustomerId: records.profile.canonicalCustomerId,
        accountUserId: records.profile.accountUserId,
        identityConfidence: records.profile.identityConfidence,
        lifecycleStage: records.profile.lifecycleStage,
        profileCreatedAt: records.profile.createdAt.toISOString(),
        account: records.account ? { ...records.account, createdAt: records.account.createdAt.toISOString() } : null,
        guestContacts: records.account ? [] : [...new Map(records.orders.filter((o) => o.contactPhone || o.contactEmail)
          .map((o) => [`${o.contactPhone}|${o.contactEmail}`, { name: o.contactName, phone: o.contactPhone, email: o.contactEmail }])).values()].slice(0, 5),
        links: records.links.map((l) => ({ kind: describeLink(l.signalType, l.identifierKey), signalType: l.signalType, status: l.status, confidence: l.confidence, identifierMasked: maskKey(l.identifierKey), linkedAt: l.createdAt.toISOString() })),
        visitorIds: records.links.filter((l) => l.identifierKey.startsWith('xp:') || l.identifierKey.startsWith('fp:')).length,
        foldedProfiles: records.foldedProfiles,
        openConflicts: records.openConflicts,
        lastSeenAt: records.lastSeenAt?.toISOString() ?? null,
      },
      value: (() => {
        const v = valueOf(records.orders);
        return { ...v, firstOrderAt: v.firstOrderAt?.toISOString() ?? null, lastOrderAt: v.lastOrderAt?.toISOString() ?? null };
      })(),
      traits,
      segments: records.segments.map((s) => ({ ...s, firstMatchedAt: s.firstMatchedAt.toISOString() })),
      consents: {
        tracking: records.consents.tracking.map((t) => ({ ...t, updatedAt: t.updatedAt.toISOString() })),
        purposes: records.consents.purposes.map((p) => ({ ...p, effectiveAt: p.effectiveAt.toISOString() })),
      },
      attribution: { credits: records.attribution, selfReported: records.selfReported },
      loyalty: records.loyalty,
      orders: records.orders.map((o) => ({
        orderNumber: o.orderNumber, placedAt: o.placedAt.toISOString(), totalUgx: o.totalUgx, status: o.status,
        paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod, district: o.district, lines: o.lines.length,
      })),
      quotes: records.quotes.map((q) => ({ ...q, createdAt: q.createdAt.toISOString() })),
      privacyRequests: records.privacyRequests.map((p) => ({ ...p, requestedAt: p.requestedAt.toISOString() })),
      timeline: buildCustomerTimeline(records),
    };
  }
}
