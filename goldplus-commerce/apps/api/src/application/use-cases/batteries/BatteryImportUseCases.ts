import { createHash } from 'node:crypto';
import type { BatteryImportType } from '@goldplus/shared';
import type { IBatteryImportRepository, ImportRowRecord, ImportSessionRecord } from '../../ports/IBatteryImportRepository';
import type { IBatteryCatalogueRepository } from '../../ports/IBatteryCatalogueRepository';
import type { IBatteryCompatibilityRepository } from '../../ports/IBatteryCompatibilityRepository';
import type { IInventoryLedgerRepository } from '../../ports/IInventoryLedgerRepository';
import type { IDeviceCatalogueRepository } from '../../ports/IDeviceCatalogueRepository';
import {
  IMPORT_FIELDS,
  IMPORT_LIMITS,
  isImportType,
  markDuplicateKeys,
  normaliseImportRow,
  previewDigest,
  suggestMapping,
  validateMapping,
  type CatalogueContext,
  type ImportMapping,
} from '../../../domain/batteries/BatteryImport';
import { batteryCodeCandidates, normaliseBatteryCode, stripCodeQualifier } from '../../../domain/batteries/BatteryCodes';
import { normaliseDeviceToken } from '../../../domain/products/Devices';
import { normaliseOptional } from '../../../domain/batteries/DeviceHierarchy';
import { toCsv } from '../../../domain/pricing/CsvSafe';
import type { BatteryCatalogueUseCases } from './BatteryCatalogueUseCases';
import type { BatteryCompatibilityUseCases } from './BatteryCompatibilityUseCases';
import type { DeviceCatalogueUseCases } from './DeviceCatalogueUseCases';
import type { InventoryLedgerUseCases } from './InventoryLedgerUseCases';
import { BatteryOperationError, forbidden, invalid, notFound, unprocessable } from './BatteryOperationError';

/** Parsed spreadsheet: one sheet, header row + data rows as string maps. */
export interface ParsedSheet {
  sheetName: string;
  columns: string[];
  rows: Record<string, string>[];
  sheetNames: string[];
}

/** Infrastructure port: parse .xlsx or .csv bytes into rows. No formula evaluation, no macros. */
export interface SpreadsheetParser {
  parse(buffer: Buffer, filename: string, sheetName: string | null): ParsedSheet;
}

const ACCEPTED_EXTENSIONS = ['.xlsx', '.csv'];
const ACCEPTED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream',
]);

export class BatteryImportUseCases {
  constructor(
    private readonly repo: IBatteryImportRepository,
    private readonly parser: SpreadsheetParser,
    private readonly batteryRepo: IBatteryCatalogueRepository,
    private readonly compatRepo: IBatteryCompatibilityRepository,
    private readonly deviceRepo: IDeviceCatalogueRepository,
    private readonly ledgerRepo: IInventoryLedgerRepository,
    private readonly batteries: BatteryCatalogueUseCases,
    private readonly compatibility: BatteryCompatibilityUseCases,
    private readonly devices: DeviceCatalogueUseCases,
    private readonly ledger: InventoryLedgerUseCases,
  ) {}

  fields(importType: string) {
    if (!isImportType(importType)) throw invalid('Unknown import type.');
    return IMPORT_FIELDS[importType];
  }

  list(limit = 100) {
    return this.repo.list(Math.min(limit, 500));
  }

  async detail(id: string) {
    const session = await this.repo.find(id);
    if (!session) throw notFound('Import');
    const [rows, events, templates] = await Promise.all([this.repo.rows(id), this.repo.events(id), this.repo.listTemplates(session.importType)]);
    return { session, rows, events, templates, fields: IMPORT_FIELDS[session.importType], suggestedMapping: session.mapping ?? suggestMapping(session.importType, session.sourceColumns) };
  }

  // ---------------------------------------------------------------- upload
  async upload(input: { importType: string; name: string; filename: string; mime: string; buffer: Buffer; sheetName: string | null; actorId: string }) {
    if (!isImportType(input.importType)) throw invalid('Unknown import type.');
    const name = input.name.trim().slice(0, 160);
    if (!name) throw invalid('Give the import a name.');
    const filename = input.filename.replace(/[^A-Za-z0-9._ ()-]/g, '_').slice(0, 255);
    const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
    if (!ACCEPTED_EXTENSIONS.includes(ext)) throw invalid('Only .xlsx and .csv files are accepted. Macro-enabled workbooks (.xlsm) are refused.');
    if (input.mime && !ACCEPTED_MIME.has(input.mime.split(';')[0].trim())) throw invalid(`Unexpected file type ${input.mime}.`);
    if (!input.buffer.length) throw invalid('The file is empty.');
    if (input.buffer.length > IMPORT_LIMITS.maxFileBytes) throw invalid(`The file is larger than ${Math.round(IMPORT_LIMITS.maxFileBytes / 1024 / 1024)} MB.`);
    if (ext === '.xlsx' && !(input.buffer[0] === 0x50 && input.buffer[1] === 0x4b)) throw invalid('This is not a valid .xlsx workbook.');

    const parsed = this.parser.parse(input.buffer, filename, input.sheetName);
    if (!parsed.columns.length) throw invalid('The sheet has no header row.');
    if (parsed.columns.length > IMPORT_LIMITS.maxColumns) throw invalid(`More than ${IMPORT_LIMITS.maxColumns} columns.`);
    if (!parsed.rows.length) throw invalid('The sheet has no data rows.');
    if (parsed.rows.length > IMPORT_LIMITS.maxRows) throw invalid(`More than ${IMPORT_LIMITS.maxRows} rows; split the file.`);
    for (const row of parsed.rows) {
      for (const [k, v] of Object.entries(row)) if (String(v).length > IMPORT_LIMITS.maxCellLength) throw invalid(`Cell "${k}" is longer than ${IMPORT_LIMITS.maxCellLength} characters.`);
    }
    const sha = createHash('sha256').update(input.buffer).digest('hex');
    const sourceSha = parsed.sheetNames.length > 1 ? createHash('sha256').update(`${sha}:${parsed.sheetName}`).digest('hex') : sha;
    const mapping = suggestMapping(input.importType, parsed.columns);
    const { session, existed } = await this.repo.create({ importType: input.importType, name, sourceFilename: filename, sourceSha256: sourceSha, sourceSheet: parsed.sheetName, sourceColumns: parsed.columns, mapping: null, rows: parsed.rows, actorId: input.actorId });
    return { session, existed, suggestedMapping: mapping, sheetNames: parsed.sheetNames };
  }

  listSheetNames(buffer: Buffer, filename: string): string[] {
    return this.parser.parse(buffer, filename, null).sheetNames;
  }

  // --------------------------------------------------------------- mapping
  async saveMapping(input: { id: string; expectedVersion: number; mapping: Partial<ImportMapping>; templateId?: string | null; saveAsTemplate?: string | null; actorId: string }) {
    const session = await this.repo.find(input.id);
    if (!session) throw notFound('Import');
    let mapping: Partial<ImportMapping> = input.mapping;
    if (input.templateId) {
      const template = await this.repo.findTemplate(input.templateId);
      if (!template || template.importType !== session.importType) throw invalid('Unknown mapping template for this import type.');
      mapping = { ...template.mapping, ...input.mapping };
    }
    const clean: ImportMapping = {};
    for (const [k, v] of Object.entries(mapping)) if (typeof v === 'string' && v) clean[k] = v;
    const errors = validateMapping(session.importType, clean, session.sourceColumns);
    if (errors.length) throw unprocessable('INVALID_MAPPING', errors[0], errors);
    let templateId = input.templateId ?? null;
    if (input.saveAsTemplate && input.saveAsTemplate.trim()) {
      const saved = await this.repo.saveTemplate(session.importType, input.saveAsTemplate.trim().slice(0, 120), clean, input.actorId);
      templateId = saved.id;
    }
    const updated = await this.repo.saveMapping(input.id, input.expectedVersion, clean, templateId, input.actorId);
    if (!updated) throw unprocessable('STALE_VERSION', 'The import changed or can no longer be mapped.');
    return updated;
  }

  listTemplates(importType: string) {
    if (!isImportType(importType)) throw invalid('Unknown import type.');
    return this.repo.listTemplates(importType);
  }

  // --------------------------------------------------------------- preview
  /**
   * The preview is a PURE pass over the rows (the domain validator takes no
   * promises), so everything it will ask the database is loaded first and
   * answered from these maps. `preload` fills the code cache; the caller adds
   * the claim, stock and receipt caches for the import types that need them.
   */
  private async catalogueContext(): Promise<CatalogueContext & { preload(codes: string[]): Promise<void> }> {
    const repo = this.batteryRepo;
    const locations = await this.ledgerRepo.listLocations();
    const codes = new Map<string, ReturnType<CatalogueContext['resolveBattery']>>();
    return {
      resolveBattery: (code: string) => codes.get(normaliseBatteryCode(code)) ?? null,
      findClaim: () => null,
      locationExists: (code) => locations.some((l) => l.code === code.trim().toUpperCase() && l.status === 'ACTIVE'),
      receiptAlreadyApplied: () => false,
      currentStock: () => null,
      async preload(rawCodes: string[]) {
        for (const raw of rawCodes) {
          const key = normaliseBatteryCode(raw);
          if (!key || codes.has(key)) continue;
          const digits = raw.replace(/\s+/g, '');
          const hits = await repo.resolveCode(batteryCodeCandidates(raw), /^\d{8,14}$/.test(digits) ? digits : null);
          const distinct = Array.from(new Map(hits.map((h) => [h.productId, h])).values());
          if (distinct.length === 1) codes.set(key, { productId: distinct[0].productId, canonicalCode: distinct[0].canonicalCode, lifecycle: distinct[0].lifecycleStatus });
          else if (distinct.length > 1) codes.set(key, { ambiguous: distinct.map((d) => d.canonicalCode) });
          else codes.set(key, null);
        }
      },
    };
  }

  async preview(input: { id: string; expectedVersion: number; actorId: string }) {
    const session = await this.repo.find(input.id);
    if (!session) throw notFound('Import');
    if (!session.mapping) throw unprocessable('INVALID_STATE', 'Map the columns before running the dry run.');
    if (!['MAPPED', 'READY_FOR_APPROVAL', 'UPLOADED'].includes(session.status)) throw unprocessable('INVALID_STATE', `A ${session.status.toLowerCase().replace(/_/g, ' ')} import cannot be previewed again.`);
    const rows = await this.repo.rows(input.id);
    const mapping = session.mapping;
    const ctx = await this.catalogueContext();
    const codeFields = session.importType === 'BATTERY_CATALOGUE' ? ['canonicalCode', 'sourceItem'] : ['batteryCode'];
    await ctx.preload(rows.flatMap((r) => codeFields.flatMap((f) => {
      const raw = mapping[f] ? String(r.sourceData[mapping[f]] ?? '').trim() : '';
      return raw ? [raw, stripCodeQualifier(raw)] : [];
    })));

    // Type-specific context that needs the database.
    if (session.importType === 'COMPATIBILITY') {
      const findClaimCache = new Map<string, { id: string; workflowStatus: string } | null>();
      ctx.findClaim = (productId, device) => findClaimCache.get(`${productId}|${normaliseDeviceToken(device.brand)}|${normaliseDeviceToken(device.model)}|${normaliseOptional(device.modelNumber) ?? ''}|${normaliseOptional(device.variant) ?? ''}`) ?? null;
      for (const r of rows) {
        const code = mapping.batteryCode ? String(r.sourceData[mapping.batteryCode] ?? '').trim() : '';
        const battery = ctx.resolveBattery(code);
        if (!battery || 'ambiguous' in battery) continue;
        const brand = mapping.deviceBrand ? String(r.sourceData[mapping.deviceBrand] ?? '').trim() : '';
        const model = mapping.deviceModel ? String(r.sourceData[mapping.deviceModel] ?? '').trim() : '';
        const modelNumber = mapping.modelNumber ? String(r.sourceData[mapping.modelNumber] ?? '').trim() : '';
        const variant = mapping.variant ? String(r.sourceData[mapping.variant] ?? '').trim() : '';
        const device = await this.deviceRepo.findDeviceByIdentity({ brandNormalised: normaliseDeviceToken(brand), modelNormalised: normaliseDeviceToken(model || modelNumber), modelNumberNormalised: normaliseOptional(modelNumber), variantNormalised: normaliseOptional(variant) });
        const claim = device ? await this.compatRepo.findPair(battery.productId, device.id) : null;
        findClaimCache.set(`${battery.productId}|${normaliseDeviceToken(brand)}|${normaliseDeviceToken(model || modelNumber)}|${normaliseOptional(modelNumber) ?? ''}|${normaliseOptional(variant) ?? ''}`, claim ? { id: claim.id, workflowStatus: claim.workflowStatus } : null);
      }
    }
    if (session.importType === 'STOCK_RECEIPT' || session.importType === 'STOCK_COUNT') {
      const stockCache = new Map<string, number | null>();
      const receiptCache = new Map<string, boolean>();
      for (const r of rows) {
        const code = mapping.batteryCode ? String(r.sourceData[mapping.batteryCode] ?? '').trim() : '';
        const battery = ctx.resolveBattery(code);
        if (!battery || 'ambiguous' in battery) continue;
        if (!stockCache.has(battery.productId)) stockCache.set(battery.productId, (await this.ledgerRepo.currentStock(battery.productId))?.stock ?? null);
        if (session.importType === 'STOCK_RECEIPT') {
          const reference = mapping.supplierReference ? String(r.sourceData[mapping.supplierReference] ?? '').trim() || null : null;
          const quantity = Number(String(r.sourceData[mapping.quantity ?? ''] ?? '').replace(/[,\s]/g, ''));
          const key = `${battery.productId}|${reference ?? ''}|${quantity}`;
          if (!receiptCache.has(key)) receiptCache.set(key, await this.ledgerRepo.receiptAlreadyApplied(battery.productId, reference, quantity));
        }
      }
      ctx.currentStock = (productId) => stockCache.get(productId) ?? null;
      ctx.receiptAlreadyApplied = (productId, reference, quantity) => receiptCache.get(`${productId}|${reference ?? ''}|${quantity}`) ?? false;
    }

    const normalised = rows.map((r) => ({ row: r, n: normaliseImportRow(session.importType, r.sourceData, mapping, ctx) }));
    markDuplicateKeys(normalised.map((x) => x.n));
    // Rows an operator already resolved keep their decision across re-previews.
    const previewRows = normalised.map(({ row, n }) => ({
      rowId: row.id,
      rowKey: n.rowKey,
      normalizedData: n.value,
      proposedAction: n.action,
      warnings: n.warnings,
      errors: n.errors,
      hold: n.hold,
    }));
    const digest = previewDigest(previewRows.map((p, i) => ({ rowNumber: rows[i].rowNumber, action: p.proposedAction, value: p.normalizedData, errors: p.errors, warnings: p.warnings, hold: p.hold })));
    const updated = await this.repo.savePreview(input.id, input.expectedVersion, digest, previewRows, input.actorId);
    if (!updated) throw unprocessable('STALE_VERSION', 'The import changed before the dry run could be stored.');
    return { session: updated, previewDigest: digest, rows: await this.repo.rows(input.id) };
  }

  async resolveRow(input: { id: string; rowId: string; resolution: 'INCLUDE' | 'EXCLUDE' | 'HOLD'; note: string | null; override: Record<string, unknown> | null; actorId: string }) {
    const session = await this.repo.find(input.id);
    if (!session) throw notFound('Import');
    if (!['READY_FOR_APPROVAL', 'MAPPED'].includes(session.status)) throw unprocessable('INVALID_STATE', 'Rows can be resolved after the dry run and before approval.');
    if (input.resolution === 'INCLUDE' && input.override) {
      // A compound row may be included only with an explicit single canonical code chosen by the operator.
      const code = typeof input.override.canonicalCode === 'string' ? input.override.canonicalCode.trim() : '';
      if (session.importType === 'BATTERY_CATALOGUE' && !code) throw invalid('To include a held battery row, state the single canonical code it becomes.');
      if (code && (/\//.test(code) || /\bAND\b/i.test(code))) throw invalid('The canonical code must be one battery reference.');
    }
    if ((input.resolution === 'EXCLUDE' || input.resolution === 'HOLD') && !(input.note ?? '').trim()) throw invalid('A note is required when excluding or holding a row.');
    const result = await this.repo.resolveRow(input.id, input.rowId, input.resolution, input.note, input.override, input.actorId);
    if (!result) throw notFound('Import row');
    return result;
  }

  // -------------------------------------------------------------- approval
  async approve(input: { id: string; expectedVersion: number; actorId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }) {
    const session = await this.repo.find(input.id);
    if (!session) throw notFound('Import');
    if (session.createdBy === input.actorId) throw forbidden('FOUR_EYES_REQUIRED', 'The person who uploaded an import cannot approve it. A second person must review the preview.');
    if (!input.reason.trim()) throw invalid('A reason is required.');
    if (input.decision === 'APPROVED' && session.validRows < 1) throw unprocessable('NO_VALID_ROWS', 'Nothing valid to apply.');
    const updated = await this.repo.approve({ ...input, reason: input.reason.trim() });
    if (!updated) throw unprocessable('STALE_VERSION', 'The import changed or is not ready for approval.');
    return updated;
  }

  // ----------------------------------------------------------------- apply
  async apply(input: { id: string; expectedVersion: number; actorId: string; canRecordCost: boolean }) {
    const session = await this.repo.beginApply(input.id, input.expectedVersion, input.actorId);
    if (!session) throw unprocessable('STALE_VERSION', 'The import changed or is not approved for apply.');
    const rows = (await this.repo.rows(input.id)).filter((r) => r.status === 'VALID' && r.normalizedData);
    for (const row of rows) {
      try {
        const outcome = await this.applyRow(session, row, input.actorId, input.canRecordCost);
        await this.repo.markRowApplied(row.id, outcome);
      } catch (error) {
        await this.repo.markRowApplied(row.id, { status: 'FAILED', appliedRecordIds: null, beforeSnapshot: null, afterSnapshot: null, error: error instanceof Error ? error.message : 'Row apply failed.' });
      }
    }
    return this.repo.finishApply(input.id, input.actorId);
  }

  private async applyRow(session: ImportSessionRecord, row: ImportRowRecord, actorId: string, canRecordCost: boolean): Promise<Parameters<IBatteryImportRepository['markRowApplied']>[1]> {
    const data = row.normalizedData as Record<string, any>;
    const ref = `${session.sourceFilename}${session.sourceSheet ? ` / ${session.sourceSheet}` : ''} row ${row.rowNumber}`;
    switch (session.importType) {
      case 'BATTERY_CATALOGUE': {
        const code = (data.canonicalCode as string) ?? '';
        if (row.proposedAction === 'UPDATE_BATTERY' || row.proposedAction === 'CREATE_BATTERY') {
          const hits = await this.batteryRepo.resolveCode(batteryCodeCandidates(code), data.barcode ?? null);
          const distinct = Array.from(new Map(hits.map((h) => [h.productId, h])).values());
          if (distinct.length > 1) throw new BatteryOperationError('AMBIGUOUS', `"${code}" now resolves to more than one battery.`);
          if (distinct.length === 1) {
            // Update only recorded facts that are blank; never price or stock.
            const existing = await this.batteryRepo.findByProductId(distinct[0].productId);
            if (!existing) throw notFound('Battery');
            const before = existing.profile;
            const patch: Record<string, unknown> = {};
            for (const key of ['supplierCode', 'barcode', 'chemistry', 'nominalVoltageMv', 'capacityMah', 'warrantyMonths', 'supplierName', 'supplierReference'] as const) {
              if (data[key] != null && (before as unknown as Record<string, unknown>)[key] == null) patch[key] = data[key];
            }
            if (data.internalNotes && !before.internalNotes) patch.internalNotes = data.internalNotes;
            if (Object.keys(patch).length) await this.batteries.update(distinct[0].productId, patch, actorId);
            for (const alias of (data.aliases as string[]) ?? []) await this.batteries.addAlias(distinct[0].productId, { alias, aliasType: 'LEGACY', source: ref }, actorId).catch(() => undefined);
            return { status: 'APPLIED', appliedRecordIds: { products: [distinct[0].productId] }, beforeSnapshot: pickProfile(before as unknown as Record<string, unknown>), afterSnapshot: patch, error: null };
          }
          const created = await this.batteries.create({
            actorId,
            canonicalCode: code,
            codeStatus: data.codeStatus ?? 'PROVISIONAL',
            name: data.name ?? null,
            brand: data.brand ?? null,
            batteryCategory: data.batteryCategory ?? 'PHONE',
            supplierCode: data.supplierCode ?? null,
            barcode: data.barcode ?? null,
            chemistry: data.chemistry ?? null,
            nominalVoltageMv: data.nominalVoltageMv ?? null,
            capacityMah: data.capacityMah ?? null,
            warrantyMonths: data.warrantyMonths ?? null,
            supplierName: data.supplierName ?? null,
            supplierReference: data.supplierReference ?? null,
            internalNotes: data.internalNotes ?? null,
            priceUgx: 0,
            aliases: ((data.aliases as string[]) ?? []).map((alias) => ({ alias, aliasType: 'LEGACY' as const, source: ref })),
            lifecycleStatus: data.lifecycleStatus === 'REVIEW' ? 'REVIEW' : 'DRAFT',
            sourceReference: ref,
            sourceImportSessionId: session.id,
          });
          return { status: 'APPLIED', appliedRecordIds: { products: [created.productId], profiles: [created.profileId] }, beforeSnapshot: null, afterSnapshot: { canonicalCode: code, productId: created.productId }, error: null };
        }
        return { status: 'SKIPPED', appliedRecordIds: null, beforeSnapshot: null, afterSnapshot: null, error: null };
      }
      case 'COMPATIBILITY': {
        if (row.proposedAction === 'SKIP_CLAIM') return { status: 'SKIPPED', appliedRecordIds: null, beforeSnapshot: null, afterSnapshot: null, error: null };
        const brand = await this.devices.ensureBrand(String(data.deviceBrand), actorId);
        const series = data.deviceSeries ? await this.devices.ensureSeries(brand.id, String(data.deviceSeries), actorId) : null;
        const { device, created: deviceCreated } = await this.devices.ensureDevice({ brandId: brand.id, seriesId: series?.id ?? null, model: String(data.deviceModel), modelNumber: data.modelNumber ?? null, variant: data.variant ?? null, sourceReference: ref }, actorId);
        const productId = String(data.batteryProductId);
        const existing = await this.compatRepo.findPair(productId, device.id);
        if (existing) {
          if (existing.workflowStatus === 'READY' || existing.workflowStatus === 'ACTIVE') return { status: 'SKIPPED', appliedRecordIds: null, beforeSnapshot: null, afterSnapshot: null, error: null };
          const updated = await this.compatibility.update(existing.id, { evidenceSource: data.evidenceSource ?? existing.evidenceSource, notes: [existing.notes, data.notes].filter(Boolean).join('\n') || null }, actorId);
          return { status: 'APPLIED', appliedRecordIds: { claims: [existing.id], devices: deviceCreated ? [device.id] : [] }, beforeSnapshot: { evidenceSource: existing.evidenceSource, notes: existing.notes }, afterSnapshot: { evidenceSource: updated?.evidenceSource ?? null }, error: null };
        }
        const { created, skipped } = await this.compatibility.create({ productId, deviceIds: [device.id], actorId, evidenceStatus: data.evidenceStatus ?? 'SUPPLIER_LISTED', evidenceSource: data.evidenceSource ?? null, notes: data.notes ?? null, sourceImportSessionId: session.id, sourceReference: ref });
        if (!created.length) throw new BatteryOperationError('CLAIM_SKIPPED', skipped[0]?.reason ?? 'Claim not created.');
        return { status: 'APPLIED', appliedRecordIds: { claims: created.map((c) => c.id), devices: deviceCreated ? [device.id] : [], brands: brand.created ? [brand.id] : [], series: series?.created ? [series.id] : [] }, beforeSnapshot: null, afterSnapshot: { claimId: created[0].id, device: device.slug }, error: null };
      }
      case 'STOCK_RECEIPT': {
        const result = await this.ledger.recordMovement({ productId: String(data.productId), movementType: 'RECEIPT', quantity: Number(data.quantity), reason: `Receipt import ${ref}`, locationCode: data.locationCode ?? null, supplierName: data.supplierName ?? null, referenceNumber: data.supplierReference ?? null, unitCostUgx: data.unitCostUgx ?? null, importSessionId: session.id, actorId, canRecordCost });
        return { status: 'APPLIED', appliedRecordIds: { movements: [result.movement.id] }, beforeSnapshot: { stockQuantity: result.before }, afterSnapshot: { stockQuantity: result.after }, error: null };
      }
      case 'STOCK_COUNT': {
        const result = await this.ledger.recordMovement({ productId: String(data.productId), movementType: 'COUNT', quantity: Number(data.countedQuantity), reason: data.reason ?? `Count import ${ref}`, locationCode: data.locationCode ?? null, importSessionId: session.id, actorId, canRecordCost: false });
        return { status: 'APPLIED', appliedRecordIds: { movements: [result.movement.id] }, beforeSnapshot: { stockQuantity: result.before }, afterSnapshot: { stockQuantity: result.after }, error: null };
      }
      case 'PRICE_UPDATE': {
        const before = await this.batteryRepo.findByProductId(String(data.productId));
        if (!before) throw notFound('Battery');
        await this.batteries.update(String(data.productId), { priceUgx: Number(data.retailPriceUgx) }, actorId);
        return { status: 'APPLIED', appliedRecordIds: { products: [String(data.productId)] }, beforeSnapshot: { priceUgx: before.product.priceUgx }, afterSnapshot: { priceUgx: Number(data.retailPriceUgx) }, error: null };
      }
    }
  }

  // -------------------------------------------------------------- rollback
  /**
   * Rollback is safe where it is possible: created draft batteries, devices and
   * claims are archived (never hard-deleted once audited); stock movements are
   * reversed by an opposite CORRECTION movement; prices are restored from the
   * snapshot. Anything touched since import is reported, not clobbered.
   */
  async rollback(input: { id: string; expectedVersion: number; actorId: string; reason: string }) {
    if (!input.reason.trim()) throw invalid('A reason is required.');
    const session = await this.repo.beginRollback(input.id, input.expectedVersion, input.actorId, input.reason);
    if (!session) throw unprocessable('STALE_VERSION', 'The import changed or is not rollback eligible.');
    const rows = (await this.repo.rows(input.id)).filter((r) => r.status === 'APPLIED');
    let rolledBack = 0;
    let failed = 0;
    const notes: string[] = [];
    for (const row of rows.reverse()) {
      try {
        const ids = row.appliedRecordIds ?? {};
        switch (session.importType) {
          case 'BATTERY_CATALOGUE': {
            // Only batteries this import CREATED are rolled back. A row that
            // filled in blanks on a battery that already existed leaves that
            // battery alone: it was not ours to remove.
            const createdBatteries = ids.profiles?.length ? ids.products ?? [] : [];
            for (const productId of createdBatteries) {
              const found = await this.batteryRepo.findByProductId(productId);
              if (!found) continue;
              if (found.profile.lifecycleStatus === 'ACTIVE') throw new Error(`${found.profile.canonicalCode} was published since import; not rolled back.`);
              if (found.product.movementCount > 0) throw new Error(`${found.profile.canonicalCode} has stock movements since import; not rolled back.`);
              await this.batteries.transition(productId, 'ARCHIVE', input.actorId, `Import rollback: ${input.reason}`);
            }
            break;
          }
          case 'COMPATIBILITY':
            for (const claimId of ids.claims ?? []) {
              const claim = await this.compatRepo.find(claimId);
              if (!claim) continue;
              if (claim.workflowStatus === 'ACTIVE') throw new Error(`Claim for ${claim.device.label} was published since import; not rolled back.`);
              if (claim.workflowStatus !== 'ARCHIVED') await this.compatibility.transition(claimId, 'ARCHIVE', input.actorId, { reason: `Import rollback: ${input.reason}` });
            }
            for (const deviceId of ids.devices ?? []) {
              const products = await this.deviceRepo.deviceMappingProducts(deviceId);
              if (products.length === 0) await this.devices.setDeviceStatus(deviceId, 'ARCHIVED', input.actorId).catch(() => undefined);
            }
            break;
          case 'STOCK_RECEIPT':
          case 'STOCK_COUNT': {
            const before = Number((row.beforeSnapshot as Record<string, unknown> | null)?.stockQuantity);
            const after = Number((row.afterSnapshot as Record<string, unknown> | null)?.stockQuantity);
            const productId = String((row.normalizedData as Record<string, unknown>).productId);
            const live = await this.ledgerRepo.currentStock(productId);
            if (!live || live.stock !== after) throw new Error(`Stock moved since import (now ${live?.stock ?? 'unknown'}, import left ${after}); not reversed.`);
            await this.ledger.recordMovement({ productId, movementType: 'CORRECTION', quantity: before, reason: `Import rollback: ${input.reason}`, importSessionId: session.id, actorId: input.actorId, canRecordCost: false });
            break;
          }
          case 'PRICE_UPDATE': {
            const productId = String((row.normalizedData as Record<string, unknown>).productId);
            const before = Number((row.beforeSnapshot as Record<string, unknown> | null)?.priceUgx);
            const found = await this.batteryRepo.findByProductId(productId);
            if (found && Number.isInteger(before)) await this.batteries.update(productId, { priceUgx: before }, input.actorId);
            break;
          }
        }
        await this.repo.markRowRolledBack(row.id);
        rolledBack += 1;
      } catch (error) {
        failed += 1;
        notes.push(`Row ${row.rowNumber}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
    const finished = await this.repo.finishRollback(input.id, input.actorId, { rolledBack, failed, info: { notes, reason: input.reason } });
    return { session: finished, rolledBack, failed, notes };
  }

  // ---------------------------------------------------------- error report
  async errorReport(id: string): Promise<{ filename: string; csv: string }> {
    const session = await this.repo.find(id);
    if (!session) throw notFound('Import');
    const rows = await this.repo.rows(id);
    const bad = rows.filter((r) => r.validationErrors.length || r.error || r.status === 'HELD');
    const header = ['row_number', 'status', 'proposed_action', 'errors', 'warnings', 'hold_reason', ...session.sourceColumns];
    const body = bad.map((r) => [
      r.rowNumber,
      r.status,
      r.proposedAction,
      [...r.validationErrors, ...(r.error ? [r.error] : [])].join(' | '),
      r.validationWarnings.join(' | '),
      r.resolutionNote ?? (r.status === 'HELD' ? String((r.normalizedData as Record<string, unknown> | null)?.hold ?? '') : ''),
      ...session.sourceColumns.map((c) => String(r.sourceData[c] ?? '')),
    ]);
    return { filename: `battery-import-${id}-errors.csv`, csv: `${toCsv([header, ...body])}\r\n` };
  }
}

function pickProfile(p: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ['canonicalCode', 'supplierCode', 'barcode', 'chemistry', 'nominalVoltageMv', 'capacityMah', 'warrantyMonths', 'supplierName', 'supplierReference', 'internalNotes']) out[k] = p[k] ?? null;
  return out;
}
