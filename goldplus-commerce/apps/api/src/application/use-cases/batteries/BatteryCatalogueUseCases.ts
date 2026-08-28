import {
  BATTERY_CATEGORY_LABELS,
  BATTERY_ALIAS_TYPES,
  type BatteryAliasType,
  type BatteryCategory,
  type BatteryChemistry,
  type BatteryLifecycleStatus,
  type EvidenceKind,
} from '@goldplus/shared';
import type { IBatteryCatalogueRepository, BatteryProfileRecord, BatteryListFilters } from '../../ports/IBatteryCatalogueRepository';
import type { IBatteryCompatibilityRepository } from '../../ports/IBatteryCompatibilityRepository';
import type { IInventoryLedgerRepository } from '../../ports/IInventoryLedgerRepository';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import type { IMediaLibraryRepository } from '../../ports/IMediaLibrary';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { MediaLibraryUseCase } from '../media/MediaLibraryUseCase';
import { batteryCodeCandidates, batterySku, batterySlug, normaliseBatteryCode } from '../../../domain/batteries/BatteryCodes';
import { assessReadiness, transitionBattery, type BatteryAction, type ReadinessReport } from '../../../domain/batteries/BatteryReadiness';
import { BatteryOperationError, conflict, invalid, notFound, unprocessable } from './BatteryOperationError';

/** The catalogue category every battery product hangs off (the products FK). */
export const BATTERY_PARENT_CATEGORY_SLUG = 'power-devices';

export interface BatteryProfilePatch {
  canonicalCode?: string;
  codeStatus?: 'CONFIRMED' | 'PROVISIONAL' | 'DEVICE_NAMED' | 'MISSING';
  supplierCode?: string | null;
  barcode?: string | null;
  batteryCategory?: BatteryCategory;
  chemistry?: BatteryChemistry | null;
  nominalVoltageMv?: number | null;
  capacityMah?: number | null;
  wattHours?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  thicknessMm?: number | null;
  weightG?: number | null;
  connectorNotes?: string | null;
  warrantyMonths?: number | null;
  supplierName?: string | null;
  supplierReference?: string | null;
  packagingNotes?: string | null;
  safetyNotes?: string | null;
  internalNotes?: string | null;
  publicNotes?: string | null;
}

export interface CreateBatteryInput extends BatteryProfilePatch {
  actorId: string;
  canonicalCode: string;
  name?: string | null;
  brand?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  priceUgx?: number | null;
  aliases?: Array<{ alias: string; aliasType?: BatteryAliasType; source?: string | null }>;
  lifecycleStatus?: 'DRAFT' | 'REVIEW';
  sourceReference?: string | null;
  sourceImportSessionId?: string | null;
}

export class BatteryCatalogueUseCases {
  private readonly audit: CreateAuditLogUseCase;

  constructor(
    private readonly repo: IBatteryCatalogueRepository,
    private readonly compat: IBatteryCompatibilityRepository,
    private readonly ledger: IInventoryLedgerRepository,
    private readonly media: MediaLibraryUseCase,
    private readonly mediaRepo: IMediaLibraryRepository,
    private readonly auditRepo: IAuditRepository,
  ) {
    this.audit = new CreateAuditLogUseCase(auditRepo);
  }

  // ---------------------------------------------------------------- reads
  list(filters: BatteryListFilters) {
    return this.repo.list({ ...filters, limit: Math.min(Math.max(filters.limit ?? 200, 1), 500) });
  }

  dashboard() {
    return this.repo.dashboard();
  }

  async detail(productId: string, canSeeCost: boolean) {
    const found = await this.repo.findByProductId(productId);
    if (!found) throw notFound('Battery');
    const [aliases, evidence, claims, movements, stock, readiness] = await Promise.all([
      this.repo.aliasesFor(productId),
      this.repo.evidenceFor('BATTERY', productId),
      this.compat.list({ productId, workflowStatus: 'ALL', limit: 500 }),
      this.ledger.movementsFor(productId, 30),
      this.ledger.currentStock(productId),
      this.readiness(productId),
    ]);
    const timeline = await this.timeline(productId, claims.map((c) => c.id));
    return {
      profile: found.profile,
      product: found.product,
      aliases,
      evidence,
      compatibility: claims,
      inventory: {
        stock: stock?.stock ?? found.product.stockQuantity,
        reserved: stock?.reserved ?? found.product.reservedQuantity,
        available: Math.max(0, (stock?.stock ?? 0) - (stock?.reserved ?? 0)),
        movements: movements.map((m) => (canSeeCost ? m : { ...m, unitCostUgx: null })),
      },
      price: { retailUgx: found.product.priceUgx, hasRetailPrice: found.product.hasRetailPrice },
      readiness,
      timeline,
    };
  }

  private async timeline(productId: string, claimIds: string[]) {
    const own = await this.auditRepoFind('battery', productId);
    const product = await this.auditRepoFind('product', productId);
    const claims = (await Promise.all(claimIds.slice(0, 50).map((id) => this.auditRepoFind('battery_compatibility', id)))).flat();
    return [...own, ...product, ...claims]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100);
  }

  private async auditRepoFind(entity: string, id: string) {
    try {
      const rows = await this.auditRepo.findByEntity(entity, id);
      return rows.map((r) => ({ id: r.id, action: r.action, entity: r.entity, entityId: r.entityId, actorId: r.actorId, previousState: r.previousState, newState: r.newState, createdAt: r.createdAt }));
    } catch {
      return [];
    }
  }

  async readiness(productId: string): Promise<ReadinessReport> {
    const found = await this.repo.findByProductId(productId);
    if (!found) throw notFound('Battery');
    const [aliases, mappings] = await Promise.all([this.repo.aliasesFor(productId), this.repo.mappingsSummary(productId)]);
    const active = aliases.filter((a) => a.isActive).map((a) => a.aliasNormalised);
    const owners = await this.repo.aliasOwners([found.profile.canonicalCodeNormalised, ...active]);
    const aliasConflicts = owners.filter((o) => o.productId !== productId).map((o) => o.aliasNormalised);
    return assessReadiness({
      canonicalCode: found.profile.canonicalCode,
      codeStatus: found.profile.codeStatus,
      verificationStatus: found.profile.verificationStatus,
      lifecycleStatus: found.profile.lifecycleStatus,
      hasPrimaryImage: found.product.hasImage || !!found.product.primaryImageUrl,
      priceUgx: found.product.priceUgx,
      // Publishing is what approves the product, so a battery that is not yet
      // live must not be blocked for the approval it is about to receive. The
      // check has teeth for a LIVE battery whose product was unapproved
      // elsewhere: that combination is a real defect and is reported.
      productApproved: found.profile.lifecycleStatus !== 'ACTIVE' || found.product.approvalStatus === 'approved',
      stockQuantity: found.product.stockQuantity,
      movementCount: found.product.movementCount,
      capacityMah: found.profile.capacityMah,
      nominalVoltageMv: found.profile.nominalVoltageMv,
      barcode: found.profile.barcode,
      warrantyMonths: found.profile.warrantyMonths,
      publicNotes: found.profile.publicNotes,
      aliasConflicts: Array.from(new Set(aliasConflicts)),
      mappings,
    });
  }

  /** Quick Add step 2: does this code, barcode or alias already exist? */
  async lookup(query: string) {
    const q = query.trim();
    if (!q) throw invalid('Type a battery code or scan a barcode.');
    const candidates = batteryCodeCandidates(q);
    const barcode = /^\d{8,14}$/.test(q.replace(/\s+/g, '')) ? q.replace(/\s+/g, '') : null;
    const hits = await this.repo.resolveCode(candidates, barcode);
    const distinct = new Map(hits.map((h) => [h.productId, h]));
    if (distinct.size === 1) {
      const hit = hits[0];
      const found = await this.repo.findByProductId(hit.productId);
      return { kind: 'FOUND' as const, battery: found, matchedOn: hit.matchedOn };
    }
    if (distinct.size > 1) return { kind: 'AMBIGUOUS' as const, matches: Array.from(distinct.values()) };
    const suggestions = await this.repo.suggestCodes(normaliseBatteryCode(q), 5);
    return { kind: 'NOT_FOUND' as const, suggestions, proposedSku: batterySku(q), normalised: normaliseBatteryCode(q) };
  }

  // --------------------------------------------------------------- writes
  async create(input: CreateBatteryInput) {
    const canonicalCode = input.canonicalCode.trim();
    if (!canonicalCode) throw invalid('A battery code is required.');
    if (canonicalCode.length > 80) throw invalid('Battery code must be 80 characters or fewer.');
    const normalised = normaliseBatteryCode(canonicalCode);
    if (!normalised) throw invalid('The battery code must contain letters or digits.');
    const category = input.batteryCategory ?? 'PHONE';
    const parent = await this.repo.findCategoryBySlug(BATTERY_PARENT_CATEGORY_SLUG);
    if (!parent) throw new BatteryOperationError('CATEGORY_MISSING', `Catalogue category "${BATTERY_PARENT_CATEGORY_SLUG}" does not exist. Create it under Categories first.`, 409);

    const aliasInputs = (input.aliases ?? [])
      .map((a) => ({ alias: a.alias.trim(), aliasNormalised: normaliseBatteryCode(a.alias), aliasType: (a.aliasType && BATTERY_ALIAS_TYPES.includes(a.aliasType) ? a.aliasType : 'SEARCH') as BatteryAliasType, source: a.source ?? null }))
      .filter((a) => a.alias && a.aliasNormalised && a.aliasNormalised !== normalised);
    const uniqueAliases = Array.from(new Map(aliasInputs.map((a) => [a.aliasNormalised, a])).values());
    const owners = await this.repo.aliasOwners([normalised, ...uniqueAliases.map((a) => a.aliasNormalised)]);
    if (owners.length) {
      throw conflict('ALIAS_CONFLICT', `${owners.map((o) => `"${o.aliasNormalised}" already resolves to ${o.canonicalCode}`).join('; ')}. One code resolves to one battery.`, owners);
    }

    const sku = batterySku(canonicalCode);
    if (await this.repo.skuExists(sku)) throw conflict('SKU_TAKEN', `SKU ${sku} already exists.`);
    let slug = batterySlug(canonicalCode, input.brand ?? null);
    for (let n = 2; await this.repo.slugExists(slug) && n < 50; n++) slug = `${batterySlug(canonicalCode, input.brand ?? null)}-${n}`;
    const name = (input.name?.trim() || `${input.brand ? `${input.brand.trim()} ` : ''}battery ${canonicalCode}`).slice(0, 255);
    const price = Math.max(0, Math.trunc(input.priceUgx ?? 0));

    const created = await this.repo.create({
      actorId: input.actorId,
      categoryId: parent.id,
      categoryName: parent.name,
      subcategory: BATTERY_CATEGORY_LABELS[category],
      sku,
      slug,
      name,
      shortDescription: (input.shortDescription ?? '').slice(0, 500),
      longDescription: (input.longDescription ?? '').slice(0, 5000),
      priceUgx: price,
      profile: {
        canonicalCode,
        canonicalCodeNormalised: normalised,
        codeStatus: input.codeStatus ?? 'PROVISIONAL',
        supplierCode: input.supplierCode ?? null,
        barcode: input.barcode ?? null,
        batteryCategory: category,
        chemistry: input.chemistry ?? null,
        nominalVoltageMv: input.nominalVoltageMv ?? null,
        capacityMah: input.capacityMah ?? null,
        wattHours: input.wattHours ?? null,
        lengthMm: input.lengthMm ?? null,
        widthMm: input.widthMm ?? null,
        thicknessMm: input.thicknessMm ?? null,
        weightG: input.weightG ?? null,
        connectorNotes: input.connectorNotes ?? null,
        warrantyMonths: input.warrantyMonths ?? null,
        supplierName: input.supplierName ?? null,
        supplierReference: input.supplierReference ?? null,
        packagingNotes: input.packagingNotes ?? null,
        safetyNotes: input.safetyNotes ?? null,
        internalNotes: input.internalNotes ?? null,
        publicNotes: input.publicNotes ?? null,
        lifecycleStatus: input.lifecycleStatus ?? 'DRAFT',
        verificationStatus: 'UNVERIFIED',
        sourceReference: input.sourceReference ?? null,
        sourceImportSessionId: input.sourceImportSessionId ?? null,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
      aliases: [{ alias: canonicalCode, aliasNormalised: normalised, aliasType: 'CANONICAL', source: 'canonical' }, ...uniqueAliases],
    });
    await this.audit.execute({ actorId: input.actorId, action: 'BATTERY_CREATED', entity: 'battery', entityId: created.productId, newState: { sku, slug, canonicalCode, category, lifecycleStatus: input.lifecycleStatus ?? 'DRAFT', aliases: uniqueAliases.map((a) => a.alias) } });
    return created;
  }

  async update(productId: string, patch: BatteryProfilePatch & { name?: string; shortDescription?: string; longDescription?: string; priceUgx?: number | null }, actorId: string) {
    const found = await this.repo.findByProductId(productId);
    if (!found) throw notFound('Battery');
    const before = found.profile;
    const profilePatch: Partial<BatteryProfileRecord> = {};
    const changed: string[] = [];

    if (patch.canonicalCode !== undefined && patch.canonicalCode.trim() !== before.canonicalCode) {
      if (before.lifecycleStatus === 'ACTIVE') throw unprocessable('LIVE_CODE_CHANGE', 'Unpublish the battery before changing its code.');
      const code = patch.canonicalCode.trim();
      const normalised = normaliseBatteryCode(code);
      if (!normalised) throw invalid('The battery code must contain letters or digits.');
      const owners = (await this.repo.aliasOwners([normalised])).filter((o) => o.productId !== productId);
      if (owners.length) throw conflict('ALIAS_CONFLICT', `"${code}" already resolves to ${owners[0].canonicalCode}.`, owners);
      profilePatch.canonicalCode = code;
      profilePatch.canonicalCodeNormalised = normalised;
      changed.push('canonicalCode');
    }
    const simple: Array<keyof BatteryProfilePatch> = ['codeStatus', 'supplierCode', 'barcode', 'batteryCategory', 'chemistry', 'nominalVoltageMv', 'capacityMah', 'wattHours', 'lengthMm', 'widthMm', 'thicknessMm', 'weightG', 'connectorNotes', 'warrantyMonths', 'supplierName', 'supplierReference', 'packagingNotes', 'safetyNotes', 'internalNotes', 'publicNotes'];
    for (const key of simple) {
      if (patch[key] !== undefined && patch[key] !== (before as unknown as Record<string, unknown>)[key]) {
        (profilePatch as Record<string, unknown>)[key] = patch[key];
        changed.push(key);
      }
    }
    if (patch.barcode) {
      const digits = patch.barcode.replace(/\s+/g, '');
      if (!/^\d{8,14}$/.test(digits)) throw invalid('Barcode must be 8 to 14 digits.');
      profilePatch.barcode = digits;
    }
    if (profilePatch.capacityMah != null && profilePatch.capacityMah <= 0) throw invalid('Capacity must be greater than zero.');
    if (profilePatch.nominalVoltageMv != null && profilePatch.nominalVoltageMv <= 0) throw invalid('Voltage must be greater than zero.');

    const productPatch: { name?: string; shortDescription?: string; longDescription?: string; subcategory?: string } = {};
    if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== found.product.name) { productPatch.name = patch.name.trim().slice(0, 255); changed.push('name'); }
    if (patch.shortDescription !== undefined && patch.shortDescription !== found.product.shortDescription) { productPatch.shortDescription = patch.shortDescription.slice(0, 500); changed.push('shortDescription'); }
    if (patch.longDescription !== undefined && patch.longDescription !== found.product.longDescription) { productPatch.longDescription = patch.longDescription.slice(0, 5000); changed.push('longDescription'); }
    if (profilePatch.batteryCategory) productPatch.subcategory = BATTERY_CATEGORY_LABELS[profilePatch.batteryCategory];

    let priceChange: { before: number; after: number } | null = null;
    if (patch.priceUgx !== undefined && patch.priceUgx !== null) {
      const price = Math.trunc(patch.priceUgx);
      if (!Number.isInteger(price) || price < 0) throw invalid('Price must be a whole number of shillings, zero or more.');
      if (price !== found.product.priceUgx) {
        priceChange = await this.repo.setRetailPrice(productId, price);
        changed.push('priceUgx');
      }
    }
    if (Object.keys(profilePatch).length) {
      // The canonical alias row follows the code; the old code stays as a legacy alias.
      if (profilePatch.canonicalCode) {
        const aliases = await this.repo.aliasesFor(productId);
        for (const a of aliases.filter((x) => x.aliasType === 'CANONICAL' && x.isActive)) await this.repo.setAliasActive(a.id, false);
        await this.repo.addAlias({ productId, alias: profilePatch.canonicalCode, aliasNormalised: profilePatch.canonicalCodeNormalised!, aliasType: 'CANONICAL', source: 'canonical', actorId });
        await this.repo.addAlias({ productId, alias: before.canonicalCode, aliasNormalised: before.canonicalCodeNormalised, aliasType: 'LEGACY', source: 'previous canonical code', actorId }).catch(() => undefined);
      }
      await this.repo.updateProfile(productId, profilePatch, actorId);
    }
    if (Object.keys(productPatch).length) await this.repo.updateProduct(productId, productPatch);
    if (changed.length) {
      const previousState: Record<string, unknown> = {};
      const newState: Record<string, unknown> = {};
      for (const key of changed) {
        previousState[key] = key === 'priceUgx' ? priceChange?.before : key in productPatch ? (found.product as unknown as Record<string, unknown>)[key] : (before as unknown as Record<string, unknown>)[key];
        newState[key] = key === 'priceUgx' ? priceChange?.after : key in productPatch ? (productPatch as Record<string, unknown>)[key] : (profilePatch as Record<string, unknown>)[key];
      }
      await this.audit.execute({ actorId, action: 'BATTERY_UPDATED', entity: 'battery', entityId: productId, previousState, newState });
    }
    return this.repo.findByProductId(productId);
  }

  async verify(productId: string, actorId: string, note: string | null) {
    const found = await this.repo.findByProductId(productId);
    if (!found) throw notFound('Battery');
    if (found.profile.codeStatus !== 'CONFIRMED') throw unprocessable('CODE_NOT_CONFIRMED', 'Confirm the printed battery code from the pack before verifying the battery.');
    const updated = await this.repo.updateProfile(productId, { verificationStatus: 'VERIFIED', verifiedBy: actorId, verifiedAt: new Date(), codeStatus: 'CONFIRMED' }, actorId);
    await this.audit.execute({ actorId, action: 'BATTERY_VERIFIED', entity: 'battery', entityId: productId, previousState: { verificationStatus: found.profile.verificationStatus }, newState: { verificationStatus: 'VERIFIED', note } });
    return updated;
  }

  async transition(productId: string, action: BatteryAction, actorId: string, reason: string | null) {
    const found = await this.repo.findByProductId(productId);
    if (!found) throw notFound('Battery');
    const readiness = action === 'MARK_READY' || action === 'PUBLISH' ? await this.readiness(productId) : { ready: true, blockers: [], warnings: [] };
    const result = transitionBattery(found.profile.lifecycleStatus, action, readiness);
    if (!result.ok) throw unprocessable(result.code, result.message, readiness.blockers);
    const next: BatteryLifecycleStatus = result.next;

    // ARCHIVING RELEASES THE CODE, AND COMING BACK MUST RE-CLAIM IT.
    //
    // `aliasOwners` treats an archived battery as owning nothing
    // (lifecycle_status <> 'ARCHIVED'), but the database's uniqueness rule is the
    // partial index battery_aliases_active_idx, which is on `is_active` alone and
    // knows nothing about lifecycle. Archiving never touched the alias rows, so
    // the two disagreed: the use case reported the code free, the INSERT then
    // violated the index, and the operator got a raw 500 from Quick Add or every
    // row of a re-import marked FAILED with constraint text.
    //
    // Deactivating the aliases here makes the database agree with the rule the
    // application already states.
    const aliases = await this.repo.aliasesFor(productId);

    if (action === 'RESTORE' || action === 'REOPEN') {
      // Coming back is a fresh claim, not a right. Another battery may have taken
      // the canonical code or an alias while this one was away, and reactivating
      // blindly would trip the same index from the other direction.
      const wanted = [
        found.profile.canonicalCodeNormalised,
        ...aliases.filter((a) => !a.isActive).map((a) => a.aliasNormalised),
      ].filter(Boolean);
      const owners = await this.repo.aliasOwners(wanted);
      const taken = owners.find((o) => o.productId !== productId);
      if (taken) {
        throw conflict(
          'ALIAS_CONFLICT',
          `"${taken.canonicalCode}" now belongs to another battery, so this one cannot be restored under the same code. Change one of them first.`,
          owners,
        );
      }
    }

    const patch: Partial<BatteryProfileRecord> = { lifecycleStatus: next };
    if (next === 'ACTIVE') { patch.publishedBy = actorId; patch.publishedAt = new Date(); patch.archivedAt = null; }
    if (next === 'ARCHIVED') patch.archivedAt = new Date();
    if (action === 'RESTORE' || action === 'REOPEN') { patch.archivedAt = null; }
    await this.repo.updateProfile(productId, patch, actorId);

    if (next === 'ARCHIVED') {
      for (const alias of aliases.filter((a) => a.isActive)) {
        await this.repo.setAliasActive(alias.id, false);
      }
    } else if (action === 'RESTORE' || action === 'REOPEN') {
      for (const alias of aliases.filter((a) => !a.isActive)) {
        await this.repo.setAliasActive(alias.id, true);
      }
    }
    await this.repo.setProductPublication(productId, next === 'ACTIVE');
    await this.audit.execute({ actorId, action: `BATTERY_${action}`, entity: 'battery', entityId: productId, previousState: { lifecycleStatus: found.profile.lifecycleStatus }, newState: { lifecycleStatus: next, reason } });
    return this.repo.findByProductId(productId);
  }

  async bulk(productIds: string[], action: BatteryAction, actorId: string) {
    const results: Array<{ productId: string; ok: boolean; message?: string }> = [];
    for (const id of productIds.slice(0, 100)) {
      try {
        await this.transition(id, action, actorId, 'bulk action');
        results.push({ productId: id, ok: true });
      } catch (error) {
        results.push({ productId: id, ok: false, message: error instanceof Error ? error.message : 'failed' });
      }
    }
    return results;
  }

  async addAlias(productId: string, input: { alias: string; aliasType?: BatteryAliasType; source?: string | null }, actorId: string) {
    const found = await this.repo.findByProductId(productId);
    if (!found) throw notFound('Battery');
    const alias = input.alias.trim();
    const normalised = normaliseBatteryCode(alias);
    if (!alias || !normalised) throw invalid('An alias must contain letters or digits.');
    if (alias.length > 120) throw invalid('Alias must be 120 characters or fewer.');
    const owners = await this.repo.aliasOwners([normalised]);
    const other = owners.find((o) => o.productId !== productId);
    if (other) throw conflict('ALIAS_CONFLICT', `"${alias}" already resolves to ${other.canonicalCode}. One alias resolves to one battery.`, owners);
    if (owners.some((o) => o.productId === productId)) throw conflict('ALIAS_EXISTS', `"${alias}" is already an alias of this battery.`);
    const type = input.aliasType && BATTERY_ALIAS_TYPES.includes(input.aliasType) ? input.aliasType : 'SEARCH';
    const created = await this.repo.addAlias({ productId, alias, aliasNormalised: normalised, aliasType: type, source: input.source ?? null, actorId });
    await this.audit.execute({ actorId, action: 'BATTERY_ALIAS_ADDED', entity: 'battery', entityId: productId, newState: { alias, aliasType: type, source: input.source ?? null } });
    return created;
  }

  async setAliasActive(productId: string, aliasId: string, active: boolean, actorId: string) {
    const aliases = await this.repo.aliasesFor(productId);
    const target = aliases.find((a) => a.id === aliasId);
    if (!target) throw notFound('Alias');
    if (target.aliasType === 'CANONICAL' && !active) throw unprocessable('CANONICAL_ALIAS', 'The canonical code cannot be archived; change the battery code instead.');
    if (active) {
      const other = (await this.repo.aliasOwners([target.aliasNormalised])).find((o) => o.productId !== productId);
      if (other) throw conflict('ALIAS_CONFLICT', `"${target.alias}" now resolves to ${other.canonicalCode}; it cannot be restored.`);
    }
    const updated = await this.repo.setAliasActive(aliasId, active);
    await this.audit.execute({ actorId, action: active ? 'BATTERY_ALIAS_RESTORED' : 'BATTERY_ALIAS_ARCHIVED', entity: 'battery', entityId: productId, previousState: { alias: target.alias, isActive: target.isActive }, newState: { alias: target.alias, isActive: active } });
    return updated;
  }

  async attachEvidence(input: { subjectType: 'BATTERY' | 'COMPATIBILITY'; subjectId: string; kind: EvidenceKind; note: string | null; files: Array<{ filename: string; mime: string; buffer: Buffer }>; actorId: string; setPrimaryImage: boolean }) {
    if (input.subjectType === 'BATTERY') {
      const found = await this.repo.findByProductId(input.subjectId);
      if (!found) throw notFound('Battery');
    } else {
      const claim = await this.compat.find(input.subjectId);
      if (!claim) throw notFound('Compatibility claim');
    }
    if (!input.files.length) throw invalid('At least one image is required.');
    if (input.files.length > 10) throw invalid('At most 10 files per upload.');
    const outcomes = await this.media.upload({ files: input.files, altText: `${input.kind} evidence`, caption: input.note, actorId: input.actorId });
    const stored: Array<{ id: string; url: string }> = [];
    const rejected: Array<{ filename: string; reason: string }> = [];
    for (const o of outcomes) {
      if (o.kind === 'STORED') {
        const evidence = await this.repo.addEvidence({ subjectType: input.subjectType, subjectId: input.subjectId, assetId: o.asset.id, kind: input.kind, note: input.note, actorId: input.actorId });
        stored.push({ id: evidence.id, url: o.asset.url });
        if (input.subjectType === 'BATTERY' && input.setPrimaryImage && stored.length === 1) {
          await this.mediaRepo.assignPrimaryProductImage(input.subjectId, o.asset);
          await this.repo.setPrimaryImageFromAsset(input.subjectId, o.asset.id, o.asset.url, o.asset.altText ?? null);
        }
      } else rejected.push({ filename: o.filename, reason: o.reason });
    }
    await this.audit.execute({ actorId: input.actorId, action: 'BATTERY_EVIDENCE_ADDED', entity: input.subjectType === 'BATTERY' ? 'battery' : 'battery_compatibility', entityId: input.subjectId, newState: { kind: input.kind, stored: stored.length, rejected } });
    return { stored, rejected };
  }
}
