import type { CompatEvidenceStatus, CompatWorkflowStatus } from '@goldplus/shared';
import type { IBatteryCompatibilityRepository, ClaimListFilters, ClaimPatch, CompatClaimRecord } from '../../ports/IBatteryCompatibilityRepository';
import type { IBatteryCatalogueRepository } from '../../ports/IBatteryCatalogueRepository';
import type { IDeviceCatalogueRepository } from '../../ports/IDeviceCatalogueRepository';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { isEvidenceStatus, isMaterialEdit, legacyConfidence, transitionClaim, type CompatAction } from '../../../domain/batteries/CompatibilityWorkflow';
import { invalid, notFound, unprocessable, conflict } from './BatteryOperationError';

export interface ClaimWrite {
  evidenceStatus?: CompatEvidenceStatus;
  evidenceType?: string | null;
  evidenceSource?: string | null;
  notes?: string | null;
  publicCondition?: string | null;
  deviceId?: string;
}

export class BatteryCompatibilityUseCases {
  private readonly audit: CreateAuditLogUseCase;
  constructor(
    private readonly repo: IBatteryCompatibilityRepository,
    private readonly batteries: IBatteryCatalogueRepository,
    private readonly devices: IDeviceCatalogueRepository,
    auditRepo: IAuditRepository,
  ) {
    this.audit = new CreateAuditLogUseCase(auditRepo);
  }

  list(filters: ClaimListFilters) {
    return this.repo.list({ ...filters, limit: Math.min(Math.max(filters.limit ?? 200, 1), 1000) });
  }

  async detail(id: string) {
    const claim = await this.repo.find(id);
    if (!claim) throw notFound('Compatibility claim');
    const [evidence, conflicts] = await Promise.all([
      this.batteries.evidenceFor('COMPATIBILITY', id),
      this.repo.conflictsForDevice(claim.deviceId, claim.productId),
    ]);
    return { claim, evidence, conflicts };
  }

  /**
   * Connect one battery to one or more exact devices. Each device becomes its
   * own DRAFT claim that must be reviewed on its own: the quick action saves
   * typing, not scrutiny.
   */
  async create(input: { productId: string; deviceIds: string[]; actorId: string; sourceImportSessionId?: string | null; sourceReference?: string | null } & ClaimWrite) {
    const battery = await this.batteries.findByProductId(input.productId);
    if (!battery) throw notFound('Battery');
    const deviceIds = Array.from(new Set(input.deviceIds.filter(Boolean)));
    if (!deviceIds.length) throw invalid('Pick at least one exact device.');
    if (deviceIds.length > 50) throw invalid('At most 50 devices per action.');
    const evidenceStatus = input.evidenceStatus ?? 'SUPPLIER_LISTED';
    if (!isEvidenceStatus(evidenceStatus)) throw invalid('Unknown evidence status.');
    if (evidenceStatus === 'REJECTED') throw invalid('A new claim cannot start rejected.');
    if (evidenceStatus === 'CONDITIONAL' && !(input.publicCondition ?? '').trim()) throw unprocessable('CONDITION_REQUIRED', 'A conditional fit must state the customer-facing condition.');
    if (evidenceStatus !== 'SUPPLIER_LISTED' && !(input.evidenceSource ?? '').trim()) throw unprocessable('EVIDENCE_REQUIRED', `${evidenceStatus} needs an evidence source (what was checked, by whom).`);

    const created: CompatClaimRecord[] = [];
    const skipped: Array<{ deviceId: string; reason: string }> = [];
    for (const deviceId of deviceIds) {
      const device = await this.devices.findDevice(deviceId);
      if (!device) { skipped.push({ deviceId, reason: 'Device not found.' }); continue; }
      if (device.status !== 'ACTIVE') { skipped.push({ deviceId, reason: `${device.brandName} ${device.model} is ${device.status.toLowerCase()}.` }); continue; }
      const existing = await this.repo.findPair(input.productId, deviceId);
      if (existing) { skipped.push({ deviceId, reason: `A claim already exists (${existing.workflowStatus}).` }); continue; }
      const claim = await this.repo.create({
        productId: input.productId,
        deviceId,
        evidenceStatus,
        evidenceType: input.evidenceType ?? null,
        evidenceSource: input.evidenceSource?.trim() || null,
        notes: input.notes ?? null,
        publicCondition: input.publicCondition?.trim() || null,
        fitType: 'exact',
        confidence: 'declared',
        createdBy: input.actorId,
        sourceImportSessionId: input.sourceImportSessionId ?? null,
        sourceReference: input.sourceReference ?? null,
      });
      created.push(claim);
      await this.audit.execute({ actorId: input.actorId, action: 'BATTERY_COMPAT_CLAIMED', entity: 'battery_compatibility', entityId: claim.id, newState: { battery: battery.profile.canonicalCode, device: device.slug, evidenceStatus, evidenceSource: claim.evidenceSource } });
    }
    return { created, skipped };
  }

  async update(id: string, patch: ClaimWrite, actorId: string) {
    const before = await this.repo.find(id);
    if (!before) throw notFound('Compatibility claim');
    const changed: string[] = [];
    const write: ClaimPatch = {};
    if (patch.evidenceStatus !== undefined && patch.evidenceStatus !== before.evidenceStatus) {
      if (!isEvidenceStatus(patch.evidenceStatus)) throw invalid('Unknown evidence status.');
      if (patch.evidenceStatus === 'REJECTED') throw invalid('Use the reject action.');
      write.evidenceStatus = patch.evidenceStatus; changed.push('evidenceStatus');
    }
    if (patch.publicCondition !== undefined && (patch.publicCondition ?? null) !== before.publicCondition) { write.publicCondition = patch.publicCondition?.trim() || null; changed.push('publicCondition'); }
    if (patch.evidenceSource !== undefined && (patch.evidenceSource ?? null) !== before.evidenceSource) { write.evidenceSource = patch.evidenceSource?.trim() || null; changed.push('evidenceSource'); }
    if (patch.evidenceType !== undefined && (patch.evidenceType ?? null) !== before.evidenceType) { write.evidenceType = patch.evidenceType; changed.push('evidenceType'); }
    if (patch.notes !== undefined && (patch.notes ?? null) !== before.notes) { write.notes = patch.notes; changed.push('notes'); }
    if (patch.deviceId !== undefined && patch.deviceId !== before.deviceId) {
      const device = await this.devices.findDevice(patch.deviceId);
      if (!device || device.status !== 'ACTIVE') throw invalid('Pick an active device.');
      const clash = await this.repo.findPair(before.productId, patch.deviceId);
      if (clash) throw conflict('CLAIM_EXISTS', 'A claim for that device already exists.');
      write.deviceId = patch.deviceId; changed.push('deviceId');
    }
    if (!changed.length) return before;
    const finalEvidence = write.evidenceStatus ?? before.evidenceStatus;
    if (finalEvidence === 'CONDITIONAL' && !((write.publicCondition ?? before.publicCondition) ?? '').trim()) throw unprocessable('CONDITION_REQUIRED', 'A conditional fit must state the customer-facing condition.');
    // A MATERIAL EDIT INVALIDATES THE VERIFICATION, WHATEVER THE CLAIM'S STATUS.
    //
    // This used to fire only for READY and ACTIVE claims, so an ARCHIVED claim
    // kept its reviewedBy through a change of device or evidence. RESTORE decides
    // between READY and DRAFT from exactly that field
    // (CompatibilityWorkflow: `const verified = !!state.reviewedBy && ...`), so
    // the archived claim came back READY and could be published, carrying one
    // person's verification of a DIFFERENT device. That is the maker/checker rule
    // defeated by a detour through the archive.
    //
    // The verification is cleared whenever there is one to clear. The workflow
    // status is only reopened from READY or ACTIVE, so an archived claim stays
    // archived: it simply comes back as a draft, needing a real second pair of
    // eyes, which is what it should always have needed.
    const hadVerification = !!(before.reviewedBy || before.verifiedBy || before.publishedBy);
    if (isMaterialEdit(changed) && (hadVerification || before.workflowStatus === 'READY' || before.workflowStatus === 'ACTIVE')) {
      if (before.workflowStatus === 'READY' || before.workflowStatus === 'ACTIVE') {
        write.workflowStatus = 'DRAFT';
        changed.push('workflowStatus');
      }
      write.publishedBy = null; write.publishedAt = null; write.reviewedBy = null; write.reviewedAt = null; write.verifiedBy = null; write.verifiedAt = null;
      write.confidence = 'declared';
    }
    const updated = await this.repo.update(id, write);
    await this.audit.execute({ actorId, action: 'BATTERY_COMPAT_UPDATED', entity: 'battery_compatibility', entityId: id, previousState: pick(before, changed), newState: pick(updated ?? before, changed) });
    return updated;
  }

  async transition(id: string, action: CompatAction, actorId: string, detail: { evidenceStatus?: CompatEvidenceStatus; publicCondition?: string | null; reason?: string } = {}) {
    const claim = await this.repo.find(id);
    if (!claim) throw notFound('Compatibility claim');
    const result = transitionClaim(
      { workflowStatus: claim.workflowStatus, evidenceStatus: claim.evidenceStatus, createdBy: claim.createdBy, submittedBy: claim.submittedBy, reviewedBy: claim.reviewedBy, publicCondition: claim.publicCondition, deviceStatus: claim.device.status },
      action,
      actorId,
      detail,
    );
    if (!result.ok) throw unprocessable(result.code, result.message);
    const now = new Date();
    const next: CompatWorkflowStatus = result.next;
    const write: ClaimPatch = { workflowStatus: next, evidenceStatus: result.evidenceStatus };
    if (action === 'SUBMIT') { write.submittedBy = actorId; write.submittedAt = now; }
    if (action === 'VERIFY') {
      write.reviewedBy = actorId; write.reviewedAt = now; write.reviewNote = detail.reason ?? null;
      write.verifiedBy = actorId; write.verifiedAt = now;
      if (detail.publicCondition !== undefined) write.publicCondition = detail.publicCondition?.trim() || null;
      if (!claim.evidenceSource) write.evidenceSource = `Verified by operator ${actorId}`;
    }
    if (action === 'REJECT') { write.reviewedBy = actorId; write.reviewedAt = now; write.reviewNote = detail.reason ?? null; write.archivedAt = now; write.verifiedBy = null; write.verifiedAt = null; }
    if (action === 'PUBLISH') { write.publishedBy = actorId; write.publishedAt = now; write.archivedAt = null; }
    if (action === 'UNPUBLISH') { write.publishedBy = null; write.publishedAt = null; }
    if (action === 'ARCHIVE') write.archivedAt = now;
    if (action === 'RESTORE') { write.archivedAt = null; if (next === 'DRAFT') { write.reviewedBy = null; write.reviewedAt = null; write.verifiedBy = null; write.verifiedAt = null; } }
    if (action === 'REOPEN') { write.publishedBy = null; write.publishedAt = null; write.reviewedBy = null; write.reviewedAt = null; write.verifiedBy = null; write.verifiedAt = null; write.archivedAt = null; }

    /**
     * The legacy `confidence` column (0070) may only say 'verified' while the
     * row still carries who verified it, when, and against what. Archiving is
     * not a loss of that history, so the actor and timestamp are kept; only a
     * rejection or a reopen clears them. If they are gone, the column is
     * downgraded rather than the write being refused by the database CHECK.
     */
    const verifiedBy = 'verifiedBy' in write ? write.verifiedBy : claim.verifiedBy;
    const verifiedAt = 'verifiedAt' in write ? write.verifiedAt : claim.verifiedAt;
    const evidenceSource = 'evidenceSource' in write ? write.evidenceSource : claim.evidenceSource;
    const projected = legacyConfidence(result.evidenceStatus, next);
    write.confidence = projected === 'verified' && (!verifiedBy || !verifiedAt || !evidenceSource) ? 'declared' : projected;
    const updated = await this.repo.update(id, write);
    await this.audit.execute({ actorId, action: `BATTERY_COMPAT_${action}`, entity: 'battery_compatibility', entityId: id, previousState: { workflowStatus: claim.workflowStatus, evidenceStatus: claim.evidenceStatus }, newState: { workflowStatus: next, evidenceStatus: result.evidenceStatus, reason: detail.reason ?? null } });
    return updated;
  }
}

function pick(record: CompatClaimRecord, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (record as unknown as Record<string, unknown>)[k];
  return out;
}
