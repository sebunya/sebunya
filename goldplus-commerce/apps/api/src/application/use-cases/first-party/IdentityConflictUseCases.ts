import type { ICustomerIdentityRepository } from '../../ports/ICustomerDnaRepository';
import type { IIdentityConflictRepository, IIdentityMergeRepository } from '../../ports/first-party/FirstPartyPorts';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { maskIdentifier } from '../customer-dna/CustomerDnaUseCases';

export const CONFLICT_RESOLUTIONS = ['KEEP_EXISTING', 'REASSIGN_TO_PROPOSED', 'DETACH', 'MERGE_GUEST_INTO_PROPOSED'] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

type Fail = { ok: false; code: string; message: string };

/** Open identity conflicts for review, identifiers masked on the server. */
export class ListIdentityConflictsUseCase {
  constructor(private readonly conflicts: IIdentityConflictRepository) {}
  async execute(limit = 50) {
    const rows = await this.conflicts.listOpen(Math.min(Math.max(1, limit), 200));
    return rows.map(({ identifierKey, ...rest }) => ({ ...rest, identifierMasked: maskIdentifier(identifierKey) }));
  }
}

/**
 * A person resolves a conflict. Nothing here happens automatically:
 * - KEEP_EXISTING         the identifier stays with the customer who had it.
 * - REASSIGN_TO_PROPOSED  the identifier moves to the other customer.
 * - DETACH                the identifier belongs to neither (shared phone, a
 *                         family laptop): the link is SPLIT and ignored.
 * - MERGE_GUEST_INTO_PROPOSED  the existing holder is a GUEST profile that is
 *                         really this customer: all its links fold in. Refused
 *                         for a profile that has an account (two accounts are
 *                         merged by the account-merge process, not here).
 */
export class ResolveIdentityConflictUseCase {
  constructor(
    private readonly conflicts: IIdentityConflictRepository,
    private readonly identities: ICustomerIdentityRepository,
    private readonly merges: IIdentityMergeRepository,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: { conflictId: string; resolution: string; reason: string; actorId: string }): Promise<{ ok: true; resolution: ConflictResolution } | Fail> {
    if (!CONFLICT_RESOLUTIONS.includes(input.resolution as ConflictResolution)) return { ok: false, code: 'BAD_INPUT', message: 'Choose how to resolve this conflict.' };
    const reason = (input.reason ?? '').trim();
    if (reason.length < 5) return { ok: false, code: 'BAD_INPUT', message: 'Say why, in a few words (at least 5 characters).' };
    const conflict = await this.conflicts.findById(input.conflictId);
    if (!conflict) return { ok: false, code: 'NOT_FOUND', message: 'Conflict not found.' };
    if (conflict.status !== 'OPEN') return { ok: false, code: 'ALREADY_RESOLVED', message: 'This conflict was already resolved.' };
    const resolution = input.resolution as ConflictResolution;
    const link = conflict.linkId ? await this.merges.findLink(conflict.linkId) : null;
    if (!link) return { ok: false, code: 'LINK_MISSING', message: 'The identity link behind this conflict no longer exists.' };

    switch (resolution) {
      case 'KEEP_EXISTING':
        await this.identities.setStatus(link.id, 'ACTIVE');
        break;
      case 'REASSIGN_TO_PROPOSED':
        await this.merges.reassignLink(link.id, conflict.proposedCanonicalId);
        await this.identities.setStatus(link.id, 'ACTIVE');
        break;
      case 'DETACH':
        await this.identities.setStatus(link.id, 'SPLIT');
        break;
      case 'MERGE_GUEST_INTO_PROPOSED': {
        const from = await this.merges.profileState(link.canonicalCustomerId);
        if (!from.exists || from.accountUserId) return { ok: false, code: 'NOT_A_GUEST', message: 'Only a guest profile (no account) can be merged here.' };
        if (from.mergedInto) return { ok: false, code: 'ALREADY_MERGED', message: 'That profile was already merged.' };
        const into = await this.merges.profileState(conflict.proposedCanonicalId);
        if (!into.exists || into.mergedInto) return { ok: false, code: 'TARGET_UNAVAILABLE', message: 'The other customer profile is not available.' };
        await this.merges.foldGuestInto(link.canonicalCustomerId, conflict.proposedCanonicalId);
        await this.identities.setStatus(link.id, 'ACTIVE');
        break;
      }
    }
    const marked = await this.conflicts.markResolved(conflict.id, { resolution, actorId: input.actorId, reason });
    if (!marked) return { ok: false, code: 'ALREADY_RESOLVED', message: 'This conflict was resolved by someone else meanwhile.' };
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId, action: 'CUSTOMER_IDENTITY_CONFLICT_RESOLVED', entity: 'customer_identity', entityId: link.id,
      previousState: { canonicalCustomerId: link.canonicalCustomerId, status: link.status },
      newState: { resolution, proposed: conflict.proposedCanonicalId, reason },
    });
    return { ok: true, resolution };
  }
}
