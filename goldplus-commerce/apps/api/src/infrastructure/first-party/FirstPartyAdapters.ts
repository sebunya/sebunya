import { createHmac } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema/identity';
import { consentEventEvidence } from '../db/schema/first-party';
import { refusedAmong } from '../db/repositories/DrizzleAdvertisingOpsRepository';
import type {
  IAccountIdentityReader, IAdvertisingRefusalReader, IConsentEvidenceRepository, IIdentifierHasher, IPersonalisationConsentReader,
} from '../../application/ports/first-party/FirstPartyPorts';

/**
 * Keyed HMAC-SHA256 with IDENTITY_HASH_PEPPER (the same secret the identity
 * graph uses). A database dump cannot turn an identifier key back into an
 * email or phone without the pepper. No pepper = no hash (null), never a
 * weaker fallback.
 */
export class HmacIdentifierHasher implements IIdentifierHasher {
  constructor(private readonly pepper: string | null | undefined) {}
  hash(normalisedValue: string): string | null {
    if (!this.pepper || this.pepper.length < 32 || !normalisedValue) return null;
    return createHmac('sha256', this.pepper).update(normalisedValue, 'utf8').digest('hex');
  }
}

export class DrizzleAccountIdentityReader implements IAccountIdentityReader {
  async findAccount(userId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
    const [row] = await db.select({ id: users.id, email: users.email, phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt, isActive: users.isActive })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (!row) return null;
    return { id: row.id, email: row.email ?? null, phone: row.phone ?? null, phoneVerified: !!row.phoneVerifiedAt };
  }
}

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An explicit, stored personalisation refusal (consent_current_state). The
 * same shape as AdvertisingConsentGate: no row = not refused (the owner
 * default grants first-party personalisation), and a refusal never lapses.
 */
export class PersonalisationConsentReader implements IPersonalisationConsentReader {
  async personalisationRefused(who: { userId?: string | null; fpClientId?: string | null }): Promise<boolean> {
    const userId = who.userId && UUID.test(who.userId) ? who.userId : null;
    const fp = who.fpClientId || null;
    if (!userId && !fp) return false;
    const found = rows(await db.execute(sql`select personalization_granted, last_grant_type from consent_current_state
      where (${userId}::uuid is not null and user_id = ${userId}::uuid) or (${fp}::text is not null and fp_client_id = ${fp}::text)`));
    return found.some((r) => r.personalization_granted === false && r.last_grant_type !== 'unknown');
  }
}

/**
 * D-002 via the SAME rule as the built-in advertising lists (refusedAmong,
 * the AdvertisingConsentGate predicate in bulk): the account, every visitor
 * id (no cap), and every browser linked to the account (identity_links). One
 * rule, so a person can never be excluded from a built-in list and uploaded
 * through an owner-defined segment.
 */
export class AdvertisingRefusalReader implements IAdvertisingRefusalReader {
  constructor(private readonly among: typeof refusedAmong = refusedAmong) {}

  async refused(who: { userId?: string | null; fpClientIds: string[] }): Promise<boolean> {
    return (await this.refusedMany([{ key: 'one', userId: who.userId ?? null, fpClientIds: who.fpClientIds }])).size > 0;
  }

  async refusedMany(subjects: Array<{ key: string; userId?: string | null; fpClientIds: string[] }>): Promise<Set<string>> {
    const out = new Set<string>();
    if (subjects.length === 0) return out;
    const r = await this.among(
      [...new Set(subjects.map((s) => s.userId).filter((u): u is string => !!u))],
      [...new Set(subjects.flatMap((s) => s.fpClientIds).filter(Boolean))],
    );
    for (const s of subjects) {
      if ((s.userId && r.userIds.has(s.userId)) || s.fpClientIds.some((f) => r.fpClientIds.has(f))) out.add(s.key);
    }
    return out;
  }
}

export class DrizzleConsentEvidenceRepository implements IConsentEvidenceRepository {
  async record(input: Parameters<IConsentEvidenceRepository['record']>[0]): Promise<void> {
    await db.insert(consentEventEvidence).values({
      consentEventId: input.consentEventId, purposeKey: input.purposeKey, channelKey: input.channelKey,
      endpointHash: input.endpointHash, endpointMasked: input.endpointMasked, copyVersionId: input.copyVersionId,
      copyTextHash: input.copyTextHash, confirmation: input.confirmation, ipHash: input.ipHash, userAgentHash: input.userAgentHash,
      sourceSurface: input.sourceSurface,
    }).onConflictDoNothing({ target: consentEventEvidence.consentEventId });
  }
  async latestFor(consentEventId: string) {
    if (!UUID.test(consentEventId)) return null;
    const [row] = await db.select({ endpointHash: consentEventEvidence.endpointHash, capturedAt: consentEventEvidence.capturedAt })
      .from(consentEventEvidence).where(and(eq(consentEventEvidence.consentEventId, consentEventId))).orderBy(desc(consentEventEvidence.capturedAt)).limit(1);
    return row ?? null;
  }
}
