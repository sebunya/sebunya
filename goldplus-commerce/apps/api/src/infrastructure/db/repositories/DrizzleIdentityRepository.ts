import { db } from "../client";
import { identityLinks } from "../schema/identity";
import { IIdentityRepository, IdentityLinkParams } from "../../../application/ports/IIdentityRepository";

export class DrizzleIdentityRepository implements IIdentityRepository {
  async saveLink(params: IdentityLinkParams): Promise<void> {
    await db.insert(identityLinks).values({
      id: params.id,
      anonymousId: params.anonymousId,
      browserId: params.browserId,
      sessionId: params.sessionId,
      cartId: params.cartId,
      leadId: params.leadId,
      customerId: params.customerId,
      emailHash: params.emailHash,
      phoneHash: params.phoneHash,
      linkType: params.linkType,
      linkConfidence: params.linkConfidence,
      sourceEventId: params.sourceEventId,
      lastSeenAt: params.lastSeenAt,
    });
  }
}
