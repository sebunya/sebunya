import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { customerIdentityLinks, customerProfiles } from '../db/schema/customer_dna';
import { customerIdentityConflicts } from '../db/schema/first-party';
import type { IdentityLinkSnapshot, IdentityLinkStatus, IdentitySignalType } from '../../domain/customer-dna/CustomerIdentity';
import type { IdentityConfidence } from '../../domain/customer-dna/CustomerProfile';
import type {
  IdentityConflictRecord, IIdentityConflictRepository, IIdentityMergeRepository, IOrderIdentityBackfillReader,
} from '../../application/ports/first-party/FirstPartyPorts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Copies a profile's consent-only browser anchors (0157) to another profile.
 * Idempotent (the primary key is profile + browser). The anchors hold browser
 * ids only, and exist only to enforce a refusal.
 */
export const copyConsentAnchorsSql = (fromCanonicalId: string, intoCanonicalId: string) => sql`
  insert into customer_consent_anchors (canonical_customer_id, fp_client_id, reason, first_seen_at)
  select ${intoCanonicalId}::uuid, fp_client_id, reason, first_seen_at from customer_consent_anchors
  where canonical_customer_id = ${fromCanonicalId}::uuid
  on conflict do nothing`;
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

function toConflict(r: typeof customerIdentityConflicts.$inferSelect): IdentityConflictRecord {
  return {
    id: r.id, linkId: r.linkId ?? null, signalType: r.signalType, identifierKey: r.identifierKey,
    existingCanonicalId: r.existingCanonicalId, proposedCanonicalId: r.proposedCanonicalId, moment: r.moment ?? null,
    occurrences: r.occurrences, status: r.status as 'OPEN' | 'RESOLVED', resolution: r.resolution ?? null,
    firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt,
  };
}

export class DrizzleIdentityConflictRepository implements IIdentityConflictRepository {
  async record(input: { linkId: string | null; signalType: IdentitySignalType; identifierKey: string; existingCanonicalId: string; proposedCanonicalId: string; moment?: string | null }) {
    // The partial unique index (status = 'OPEN') makes a repeat an UPDATE.
    const inserted = rows(await db.execute(sql`
      insert into customer_identity_conflicts (link_id, signal_type, identifier_key, existing_canonical_id, proposed_canonical_id, moment)
      values (${input.linkId}::uuid, ${input.signalType}, ${input.identifierKey}, ${input.existingCanonicalId}::uuid, ${input.proposedCanonicalId}::uuid, ${input.moment ?? null})
      on conflict (signal_type, identifier_key, existing_canonical_id, proposed_canonical_id) where status = 'OPEN'
      do update set occurrences = customer_identity_conflicts.occurrences + 1, last_seen_at = now()
      returning id, (xmax = 0) as created`));
    const row = inserted[0];
    return { created: row?.created === true, id: String(row?.id ?? '') };
  }
  async listOpen(limit: number) {
    const r = await db.select().from(customerIdentityConflicts).where(eq(customerIdentityConflicts.status, 'OPEN'))
      .orderBy(desc(customerIdentityConflicts.lastSeenAt)).limit(limit);
    return r.map(toConflict);
  }
  async findById(id: string) {
    if (!UUID.test(id)) return null;
    const [r] = await db.select().from(customerIdentityConflicts).where(eq(customerIdentityConflicts.id, id)).limit(1);
    return r ? toConflict(r) : null;
  }
  async markResolved(id: string, input: { resolution: string; actorId: string; reason: string }) {
    const r = await db.update(customerIdentityConflicts).set({
      status: 'RESOLVED', resolution: input.resolution, resolvedBy: input.actorId.slice(0, 80), resolutionReason: input.reason.slice(0, 1000), resolvedAt: new Date(),
    }).where(and(eq(customerIdentityConflicts.id, id), eq(customerIdentityConflicts.status, 'OPEN'))).returning({ id: customerIdentityConflicts.id });
    return r.length > 0;
  }
}

export class DrizzleIdentityMergeRepository implements IIdentityMergeRepository {
  async attachAccount(canonicalCustomerId: string, accountUserId: string) {
    const r = await db.update(customerProfiles).set({ accountUserId, updatedAt: new Date() })
      .where(and(eq(customerProfiles.canonicalCustomerId, canonicalCustomerId), isNull(customerProfiles.accountUserId), isNull(customerProfiles.mergedInto)))
      .returning({ id: customerProfiles.canonicalCustomerId });
    return r.length > 0;
  }
  async foldGuestInto(fromCanonicalId: string, intoCanonicalId: string) {
    if (fromCanonicalId === intoCanonicalId) return { folded: false, movedLinks: 0 };
    return db.transaction(async (tx) => {
      const marked = await tx.update(customerProfiles).set({ mergedInto: intoCanonicalId, mergedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(customerProfiles.canonicalCustomerId, fromCanonicalId), isNull(customerProfiles.accountUserId), isNull(customerProfiles.mergedInto)))
        .returning({ id: customerProfiles.canonicalCustomerId });
      if (marked.length === 0) return { folded: false, movedLinks: 0 };
      // Links are MOVED (never deleted). A link the target already holds for the
      // same identifier cannot exist: (signal_type, identifier_key) is unique.
      const moved = await tx.update(customerIdentityLinks).set({ canonicalCustomerId: intoCanonicalId, status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(customerIdentityLinks.canonicalCustomerId, fromCanonicalId)).returning({ id: customerIdentityLinks.id });
      // The guest's consent-only browser anchors go with them, in the same
      // transaction: every advertising consent read joins anchors on the
      // CURRENT profile, so a refusal left on the folded profile would be lost
      // and the person uploaded or sent as a conversion.
      await tx.execute(copyConsentAnchorsSql(fromCanonicalId, intoCanonicalId));
      return { folded: true, movedLinks: moved.length };
    });
  }
  async reassignLink(linkId: string, canonicalCustomerId: string) {
    if (!UUID.test(linkId) || !UUID.test(canonicalCustomerId)) return;
    await db.transaction(async (tx) => {
      const [before] = await tx.select({ from: customerIdentityLinks.canonicalCustomerId }).from(customerIdentityLinks).where(eq(customerIdentityLinks.id, linkId)).limit(1);
      await tx.update(customerIdentityLinks).set({ canonicalCustomerId, updatedAt: new Date() }).where(eq(customerIdentityLinks.id, linkId));
      // The link's customer may have refused advertising on a browser anchored
      // to the old profile: the anchors are COPIED (kept on both profiles), so
      // the refusal still applies whichever profile the link now names. A
      // consent anchor only ever excludes; copying one can never add a send.
      if (before?.from && before.from !== canonicalCustomerId) await tx.execute(copyConsentAnchorsSql(before.from, canonicalCustomerId));
    });
  }
  async profileState(canonicalCustomerId: string) {
    if (!UUID.test(canonicalCustomerId)) return { exists: false, accountUserId: null, mergedInto: null };
    const [r] = await db.select({ accountUserId: customerProfiles.accountUserId, mergedInto: customerProfiles.mergedInto })
      .from(customerProfiles).where(eq(customerProfiles.canonicalCustomerId, canonicalCustomerId)).limit(1);
    return r ? { exists: true, accountUserId: r.accountUserId ?? null, mergedInto: r.mergedInto ?? null } : { exists: false, accountUserId: null, mergedInto: null };
  }
  async findLink(linkId: string): Promise<IdentityLinkSnapshot | null> {
    if (!UUID.test(linkId)) return null;
    const [r] = await db.select().from(customerIdentityLinks).where(eq(customerIdentityLinks.id, linkId)).limit(1);
    if (!r) return null;
    return {
      id: r.id, canonicalCustomerId: r.canonicalCustomerId, signalType: r.signalType as IdentitySignalType, identifierKey: r.identifierKey,
      confidence: r.confidence as IdentityConfidence, status: r.status as IdentityLinkStatus, createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }
}

/** Orders with no `order:<id>` link yet, oldest first, with the visitor id checkout recorded. */
export class DrizzleOrderIdentityBackfillReader implements IOrderIdentityBackfillReader {
  async listUnlinkedOrders(limit: number) {
    const r = rows(await db.execute(sql`
      select o.id, o.user_id, o.customer_email, o.customer_phone, o.profile_id, oa.fp_client_id
      from orders o
      left join order_attribution oa on oa.order_id = o.id
      where not exists (
        select 1 from customer_identity_links l
        where l.signal_type = 'ORDER_CUSTOMER_RELATIONSHIP' and l.identifier_key = 'order:' || o.id::text
      )
      order by o.created_at asc
      limit ${Math.max(1, Math.min(limit, 5000))}`));
    return r.map((x) => ({
      orderId: String(x.id), userId: x.user_id ? String(x.user_id) : null, customerEmail: x.customer_email ?? null,
      customerPhone: x.customer_phone ?? null, profileId: x.profile_id ? String(x.profile_id) : null, fpClientId: x.fp_client_id ?? null,
    }));
  }
}

/** Orders linked to a customer / all orders — how complete the customer view is. */
export async function orderLinkCoverage(): Promise<{ orders: number; linkedOrders: number }> {
  const [r] = rows(await db.execute(sql`
    select count(*)::int as orders,
      count(*) filter (where exists (
        select 1 from customer_identity_links l
        where l.signal_type = 'ORDER_CUSTOMER_RELATIONSHIP' and l.identifier_key = 'order:' || o.id::text and l.status = 'ACTIVE'
      ))::int as linked
    from orders o`));
  return { orders: Number(r?.orders ?? 0), linkedOrders: Number(r?.linked ?? 0) };
}
