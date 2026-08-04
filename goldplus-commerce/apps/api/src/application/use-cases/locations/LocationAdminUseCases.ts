import { foldUgandanOrthography } from '@goldplus/shared';
import {
  DataExceptionRow,
  ILocationAdminRepository,
  LandmarkRow,
  PickupPointRow,
  ReviewQueueAddress,
  SearchMissGroup,
  ZonePolicyRow,
} from '../../ports/ILocationAdmin';
import { IAddressAuditRepository } from '../../ports/IAddressAudit';
import { validateZonePolicy } from '../../../domain/locations/DeliveryZonePolicy';

/**
 * Admin Locations use cases (brief PART J.1). Every mutation is audited by the
 * caller through the existing audit path; address views are logged per row.
 */

export class ListSearchMissesUseCase {
  constructor(private readonly repo: ILocationAdminRepository) {}
  execute(limit = 100): Promise<SearchMissGroup[]> {
    return this.repo.listSearchMissGroups(Math.min(limit, 500));
  }
}

export type PromoteAliasResult =
  | { ok: true; created: boolean; resolvedMisses: number }
  | { ok: false; code: 'UNKNOWN_AREA' | 'BAD_INPUT'; message: string };

export class PromoteSearchMissToAliasUseCase {
  constructor(private readonly repo: ILocationAdminRepository) {}

  /**
   * One click turns an unresolved query into a living alias (the loop that
   * brought Kalerwe and Najjera into the system properly). The alias anchors
   * to a REAL area or is refused; the promoting actor is recorded.
   */
  async execute(input: {
    query: string;
    areaSlug: string;
    confidence: 'exact' | 'strong' | 'approximate';
    actorId: string;
    note?: string | null;
  }): Promise<PromoteAliasResult> {
    const alias = input.query.trim();
    if (alias.length < 2 || alias.length > 160) {
      return { ok: false, code: 'BAD_INPUT', message: 'Alias must be 2–160 characters.' };
    }
    if (!(await this.repo.areaExists(input.areaSlug))) {
      return { ok: false, code: 'UNKNOWN_AREA', message: `"${input.areaSlug}" is not a known area.` };
    }
    const normalised = foldUgandanOrthography(alias);
    const { created } = await this.repo.createAlias({
      alias,
      normalisedAlias: normalised,
      areaSlug: input.areaSlug,
      confidence: input.confidence,
      source: 'ops_promoted',
      createdBy: input.actorId,
      note: input.note ?? null,
    });
    const resolvedMisses = await this.repo.markMissesResolved(normalised, input.areaSlug);
    return { ok: true, created, resolvedMisses };
  }
}

export class ListAddressReviewQueueUseCase {
  constructor(
    private readonly repo: ILocationAdminRepository,
    private readonly audit: IAddressAuditRepository,
  ) {}
  async execute(actorId: string, limit = 100): Promise<ReviewQueueAddress[]> {
    const rows = await this.repo.listReviewQueue(Math.min(limit, 200));
    // Brief PART K: every admin view of an address is logged.
    for (const row of rows) {
      await this.audit.append({
        addressId: row.id,
        actorType: 'ops',
        actorId,
        action: 'viewed_by_admin',
        note: 'review_queue',
      });
    }
    return rows;
  }
}

export type ResolveAddressResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'UNKNOWN_AREA'; message: string };

export class ResolveAddressUseCase {
  constructor(
    private readonly repo: ILocationAdminRepository,
    private readonly audit: IAddressAuditRepository,
  ) {}

  /** Ops assigns an area; the original text is preserved, never overwritten. */
  async execute(input: { addressId: string; areaSlug: string; actorId: string; note?: string | null }): Promise<ResolveAddressResult> {
    const area = await this.repo.areaSummary(input.areaSlug);
    if (!area) return { ok: false, code: 'UNKNOWN_AREA', message: `"${input.areaSlug}" is not a known area.` };
    const result = await this.repo.resolveAddress({
      addressId: input.addressId,
      areaSlug: input.areaSlug,
      snapshotAreaLabel: area.displayLabel,
      snapshotDistrict: area.currentDistrict,
      snapshotPostcode: area.postcode,
      snapshotDataVersion: area.dataVersion,
    });
    if (!result) return { ok: false, code: 'NOT_FOUND', message: 'Address not found or not awaiting review.' };
    await this.audit.append({
      addressId: input.addressId,
      actorType: 'ops',
      actorId: input.actorId,
      action: 'ops_resolved',
      before: result.before,
      after: result.after,
      note: input.note ?? null,
    });
    return { ok: true };
  }
}

export class ManageLandmarksUseCase {
  constructor(private readonly repo: ILocationAdminRepository) {}
  list(areaSlug: string | null, limit = 200): Promise<LandmarkRow[]> {
    return this.repo.listLandmarks(areaSlug, Math.min(limit, 500));
  }
  async upsert(input: { areaSlug: string; name: string; landmarkType: string; verified?: boolean; gpsLat?: number | null; gpsLng?: number | null }): Promise<LandmarkRow | { error: string }> {
    if (!(await this.repo.areaExists(input.areaSlug))) return { error: `"${input.areaSlug}" is not a known area.` };
    if (!input.name.trim() || input.name.length > 160) return { error: 'Landmark name must be 1–160 characters.' };
    return this.repo.upsertLandmark(input);
  }
  verify(id: string, verified: boolean): Promise<boolean> {
    return this.repo.setLandmarkVerified(id, verified);
  }
  merge(keepId: string, mergeId: string): Promise<boolean> {
    return this.repo.mergeLandmarks(keepId, mergeId);
  }
}

export class ManagePickupPointsUseCase {
  constructor(private readonly repo: ILocationAdminRepository) {}
  list(): Promise<PickupPointRow[]> {
    return this.repo.listPickupPoints();
  }
  async upsert(input: Partial<PickupPointRow> & { name: string; operator: string }): Promise<PickupPointRow | { error: string }> {
    if (!input.name.trim()) return { error: 'Name is required.' };
    if (input.areaSlug && !(await this.repo.areaExists(input.areaSlug))) return { error: `"${input.areaSlug}" is not a known area.` };
    return this.repo.upsertPickupPoint(input);
  }
  setActive(id: string, active: boolean): Promise<boolean> {
    return this.repo.setPickupPointActive(id, active);
  }
}

export type SaveZonePolicyResult =
  | { ok: true; policy: ZonePolicyRow }
  | { ok: false; code: string; message: string; missing?: string[] };

export class SaveZonePolicyUseCase {
  constructor(private readonly repo: ILocationAdminRepository) {}
  async execute(input: ZonePolicyRow & { updatedBy: string }): Promise<SaveZonePolicyResult> {
    const validation = validateZonePolicy(input);
    if (!validation.ok) {
      return { ok: false, code: validation.code, message: validation.message, missing: validation.missing };
    }
    const policy = await this.repo.saveZonePolicy(input);
    return { ok: true, policy };
  }
}

export class GetZonePoliciesUseCase {
  constructor(private readonly repo: ILocationAdminRepository) {}
  execute(): Promise<ZonePolicyRow[]> {
    return this.repo.listZonePolicies();
  }
}

export class ListDataExceptionsUseCase {
  constructor(private readonly repo: ILocationAdminRepository) {}
  execute(): Promise<DataExceptionRow[]> {
    return this.repo.listDataExceptions();
  }
}
