import { hashForAdPlatforms, hasAnyIdentifier } from '../../../domain/first-party/AudienceHashing';
import type {
  IAdvertisingRefusalReader, ICustomerContactReader, ISegmentAudienceSource, ISegmentRepository, IWhatsAppMarketingGate,
} from '../../ports/first-party/FirstPartyPorts';

const DEFAULT_LIMIT = 10_000;
const PAGE = 500;
/** Members per consent read (refusedMany). */
export const CONSENT_CHUNK = 500;

/**
 * The segment → audience port for the advertising audience sync and for
 * future messaging. Consent is applied HERE, per member, every time it is
 * read — a segment itself carries no permission:
 * - advertising: AdvertisingConsentGate (D-002: an explicit stored refusal,
 *   by account or by any of the customer's visitor ids, excludes them; an
 *   unreadable answer excludes them too — never sent on an unknown);
 * - WhatsApp messaging: the whatsapp_marketing purpose, for the number that
 *   was opted in. Guests (no account) cannot have opted in.
 * Advertising members carry only SHA-256 hashes (domain/first-party/AudienceHashing).
 */
export class SegmentAudienceService implements ISegmentAudienceSource {
  constructor(
    private readonly segments: ISegmentRepository,
    private readonly contacts: ICustomerContactReader,
    private readonly advertising: IAdvertisingRefusalReader,
    private readonly whatsapp: IWhatsAppMarketingGate,
  ) {}

  private async segmentFor(segmentId: string) {
    const s = await this.segments.findById(segmentId);
    if (!s) return { status: 'SEGMENT_NOT_FOUND' as const, s: null };
    if (s.status === 'ARCHIVED') return { status: 'SEGMENT_ARCHIVED' as const, s };
    if (!s.lastMaterialisedAt) return { status: 'NOT_MATERIALISED' as const, s };
    return { status: 'OK' as const, s };
  }

  private async memberIds(segmentId: string, limit: number): Promise<string[]> {
    const ids: string[] = [];
    let after: string | null = null;
    while (ids.length < limit) {
      const page = await this.segments.listMembers(segmentId, Math.min(PAGE, limit - ids.length), after);
      if (page.length === 0) break;
      ids.push(...page.map((p) => p.canonicalCustomerId));
      after = page[page.length - 1].canonicalCustomerId;
      if (page.length < PAGE) break;
    }
    return ids;
  }

  async advertisingAudience(segmentId: string, opts: { limit?: number } = {}) {
    const found = await this.segmentFor(segmentId);
    const empty = { members: [], excludedAdvertisingRefused: 0, excludedNoIdentifier: 0, excludedConsentUnknown: 0 };
    if (found.status !== 'OK') {
      return { status: found.status, segment: found.s ? { id: found.s.id, key: found.s.key, name: found.s.name, materialisedAt: found.s.lastMaterialisedAt?.toISOString() ?? null } : null, ...empty };
    }
    const s = found.s!;
    const ids = await this.memberIds(segmentId, Math.min(opts.limit ?? DEFAULT_LIMIT, 100_000));
    const contacts = await this.contacts.contactsFor(ids);
    const out = { ...empty, members: [] as Array<{ canonicalCustomerId: string; hashed: ReturnType<typeof hashForAdPlatforms> }> };
    // ONE consent read per chunk of CONSENT_CHUNK members (not one per member):
    // a 100,000-member segment is 200 reads, not 100,000+.
    for (let i = 0; i < contacts.length; i += CONSENT_CHUNK) {
      const chunk = contacts.slice(i, i + CONSENT_CHUNK);
      let refused: Set<string>;
      try {
        refused = await this.advertising.refusedMany(chunk.map((c) => ({ key: c.canonicalCustomerId, userId: c.accountUserId, fpClientIds: c.fpClientIds })));
      } catch {
        // Unreadable consent excludes the whole chunk: never uploaded on an unknown answer.
        out.excludedConsentUnknown += chunk.length;
        continue;
      }
      for (const c of chunk) {
        if (refused.has(c.canonicalCustomerId)) { out.excludedAdvertisingRefused++; continue; }
        const hashed = hashForAdPlatforms({ email: c.email, phone: c.phone });
        if (!hasAnyIdentifier(hashed)) { out.excludedNoIdentifier++; continue; }
        out.members.push({ canonicalCustomerId: c.canonicalCustomerId, hashed });
      }
    }
    return { status: 'OK' as const, segment: { id: s.id, key: s.key, name: s.name, materialisedAt: s.lastMaterialisedAt?.toISOString() ?? null }, ...out };
  }

  async messagingAudience(segmentId: string, _channel: 'whatsapp', opts: { limit?: number } = {}) {
    const found = await this.segmentFor(segmentId);
    if (found.status !== 'OK') return { status: found.status, members: [], excludedNotOptedIn: 0, excludedGuest: 0 };
    const ids = await this.memberIds(segmentId, Math.min(opts.limit ?? DEFAULT_LIMIT, 100_000));
    const contacts = await this.contacts.contactsFor(ids);
    const members: Array<{ canonicalCustomerId: string; accountUserId: string; phoneE164: string }> = [];
    let excludedNotOptedIn = 0;
    let excludedGuest = 0;
    for (const c of contacts) {
      if (!c.accountUserId) { excludedGuest++; continue; }
      const gate = await this.whatsapp.mayMarket(c.accountUserId).catch(() => ({ allowed: false, reason: 'UNREADABLE', phoneE164: null }));
      if (!gate.allowed || !gate.phoneE164) { excludedNotOptedIn++; continue; }
      members.push({ canonicalCustomerId: c.canonicalCustomerId, accountUserId: c.accountUserId, phoneE164: gate.phoneE164 });
    }
    return { status: 'OK' as const, members, excludedNotOptedIn, excludedGuest };
  }
}
