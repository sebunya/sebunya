import { createHash } from 'node:crypto';
import {
  BATTERY_CATEGORIES,
  BATTERY_CHEMISTRIES,
  BATTERY_IMPORT_TYPES,
  COMPAT_EVIDENCE_STATUSES,
  type BatteryCategory,
  type BatteryChemistry,
  type BatteryImportType,
  type CompatEvidenceStatus,
} from '@goldplus/shared';
import { normaliseDeviceToken } from '../products/Devices';
import { analyseSourceLine, displayCode, knownConflict, looksLikeRouterBattery, normaliseBatteryCode, stripCodeQualifier } from './BatteryCodes';

/**
 * Staged spreadsheet import rules. Pure domain.
 *
 * Every import type declares its target fields; the operator maps source
 * columns onto them (a saved mapping template is just a stored mapping). Rows
 * are normalised and validated deterministically, each with a proposed action,
 * warnings and errors. Compound and conflicting battery lines are HELD, never
 * guessed. Nothing here writes anything.
 */

export const IMPORT_LIMITS = {
  maxRows: 5000,
  maxColumns: 60,
  maxCellLength: 2000,
  maxFileBytes: 5 * 1024 * 1024,
} as const;

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  hint: string;
}

export const IMPORT_FIELDS: Record<BatteryImportType, ImportField[]> = {
  BATTERY_CATALOGUE: [
    { key: 'sourceItem', label: 'Source item / stock label', required: false, hint: 'The label as written on the stock list, e.g. GP-49FT. Kept as an alias.' },
    { key: 'canonicalCode', label: 'Battery code', required: false, hint: 'The printed battery reference, e.g. BL-49FT. Required unless the source item is a code.' },
    { key: 'supplierCode', label: 'Supplier code', required: false, hint: 'The supplier part number when different.' },
    { key: 'barcode', label: 'Barcode / GTIN', required: false, hint: 'Digits only.' },
    { key: 'batteryCategory', label: 'Battery category', required: false, hint: 'Phone Battery, MiFi / Router Battery or Other. Defaults to Phone.' },
    { key: 'brand', label: 'Customer brand', required: false, hint: 'The phone brand this battery is sold for, for naming only.' },
    { key: 'name', label: 'Product name', required: false, hint: 'Display name. Defaults to "<Brand> battery <code>".' },
    { key: 'capacityMah', label: 'Capacity (mAh)', required: false, hint: 'Whole number from the pack.' },
    { key: 'voltageV', label: 'Nominal voltage (V)', required: false, hint: 'e.g. 3.85' },
    { key: 'chemistry', label: 'Chemistry', required: false, hint: 'Li-ion, Li-polymer, NiMH.' },
    { key: 'warrantyMonths', label: 'Warranty (months)', required: false, hint: 'Whole number.' },
    { key: 'supplierName', label: 'Supplier', required: false, hint: '' },
    { key: 'supplierReference', label: 'Supplier reference', required: false, hint: '' },
    { key: 'identifierType', label: 'Identifier type', required: false, hint: 'Audit workbook column: Battery reference only, Device-named line, Compound battery reference...' },
    { key: 'mappingStatus', label: 'Mapping status', required: false, hint: 'Audit workbook column: Mapped - provisional, Conflict - resolve...' },
    { key: 'compatibilitySummary', label: 'Compatibility summary', required: false, hint: 'Kept as an internal note.' },
    { key: 'criticalIssue', label: 'Critical issue', required: false, hint: 'Kept as an internal note.' },
    { key: 'requiredAction', label: 'Required action', required: false, hint: 'Kept as an internal note.' },
    { key: 'sourceNo', label: 'Source row number', required: false, hint: 'For traceability.' },
    { key: 'notes', label: 'Notes', required: false, hint: 'Internal notes.' },
  ],
  COMPATIBILITY: [
    { key: 'batteryCode', label: 'Battery code or alias', required: true, hint: 'Must resolve to one existing battery.' },
    { key: 'deviceBrand', label: 'Device brand', required: true, hint: 'e.g. TECNO' },
    { key: 'deviceSeries', label: 'Series / family', required: false, hint: 'e.g. Spark' },
    { key: 'deviceModel', label: 'Marketing name', required: false, hint: 'e.g. Spark 7. Required unless a model number is given.' },
    { key: 'modelNumber', label: 'Exact model number', required: false, hint: 'e.g. KF6n, SM-A326B. "pending" values are treated as blank.' },
    { key: 'variant', label: 'Variant', required: false, hint: 'Regional or carrier variant.' },
    { key: 'evidenceStatus', label: 'Evidence status', required: false, hint: 'SUPPLIER_LISTED (default), PACKAGE_VERIFIED, FIT_TESTED. Imports never publish.' },
    { key: 'evidenceSource', label: 'Evidence source', required: false, hint: 'Where the claim comes from.' },
    { key: 'evidenceUrl', label: 'Evidence URL', required: false, hint: '' },
    { key: 'condition', label: 'Condition / conflict note', required: false, hint: 'Kept as an internal note; a conflict holds the row.' },
    { key: 'claimId', label: 'Claim id', required: false, hint: 'For traceability.' },
    { key: 'sourceNo', label: 'Source row number', required: false, hint: 'For traceability.' },
  ],
  STOCK_RECEIPT: [
    { key: 'batteryCode', label: 'Battery code, alias, SKU or barcode', required: true, hint: 'Must resolve to one existing battery.' },
    { key: 'quantity', label: 'Quantity received', required: true, hint: 'Whole number greater than zero.' },
    { key: 'unitCostUgx', label: 'Unit cost (UGX)', required: false, hint: 'Applied only by an operator allowed to manage costs.' },
    { key: 'supplierName', label: 'Supplier', required: true, hint: '' },
    { key: 'supplierReference', label: 'Supplier invoice / delivery reference', required: false, hint: '' },
    { key: 'locationCode', label: 'Stock location code', required: false, hint: 'Defaults to the default location.' },
    { key: 'notes', label: 'Notes', required: false, hint: '' },
  ],
  STOCK_COUNT: [
    { key: 'batteryCode', label: 'Battery code, alias, SKU or barcode', required: true, hint: '' },
    { key: 'countedQuantity', label: 'Counted quantity', required: true, hint: 'Whole number, zero or more.' },
    { key: 'reason', label: 'Reason for any difference', required: false, hint: 'Required when the count differs from the system.' },
    { key: 'locationCode', label: 'Stock location code', required: false, hint: '' },
  ],
  PRICE_UPDATE: [
    { key: 'batteryCode', label: 'Battery code, alias, SKU or barcode', required: true, hint: '' },
    { key: 'retailPriceUgx', label: 'Retail price (UGX)', required: true, hint: 'Whole number of shillings (Price D).' },
  ],
};

export type ImportMapping = Record<string, string>;

export function isImportType(value: string): value is BatteryImportType {
  return (BATTERY_IMPORT_TYPES as readonly string[]).includes(value);
}

const COLUMN = /^.{1,120}$/;

export function validateMapping(importType: BatteryImportType, mapping: Partial<ImportMapping>, sourceColumns: string[]): string[] {
  const errors: string[] = [];
  const fields = IMPORT_FIELDS[importType];
  const columns = new Set(sourceColumns);
  for (const f of fields) {
    const col = mapping[f.key];
    if (col == null || col === '') {
      if (f.required) errors.push(`${f.label} must be mapped to a source column.`);
      continue;
    }
    if (typeof col !== 'string' || !COLUMN.test(col)) errors.push(`${f.label}: invalid column name.`);
    else if (sourceColumns.length && !columns.has(col)) errors.push(`${f.label}: column "${col}" is not in the file.`);
  }
  const used = Object.values(mapping).filter((v) => v);
  if (new Set(used).size !== used.length) errors.push('Each source column may be mapped to one target field only.');
  for (const key of Object.keys(mapping)) if (!fields.some((f) => f.key === key)) errors.push(`Unknown target field "${key}".`);
  return errors;
}

/** Suggest a mapping from header names (exact, case-insensitive, punctuation-insensitive). */
export function suggestMapping(importType: BatteryImportType, sourceColumns: string[]): ImportMapping {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const synonyms: Record<string, string[]> = {
    sourceItem: ['rawinventoryitem', 'item', 'sourceitem', 'stocklabel', 'originalitem'],
    canonicalCode: ['candidatebatteryreference', 'batteryreference', 'batterycode', 'code', 'canonicalcode', 'partnumber'],
    supplierCode: ['suppliercode', 'supplierpartcode'],
    barcode: ['barcode', 'gtin', 'ean'],
    batteryCategory: ['producttype', 'batterycategory', 'category'],
    brand: ['customerbrand', 'brand', 'devicebrand'],
    name: ['productname', 'name'],
    capacityMah: ['capacitymah', 'capacity', 'mah'],
    voltageV: ['voltagev', 'voltage', 'nominalvoltage'],
    chemistry: ['chemistry'],
    warrantyMonths: ['warrantymonths', 'warranty'],
    supplierName: ['supplier', 'suppliername'],
    supplierReference: ['supplierreference', 'invoice', 'deliveryreference', 'supplierinvoicedeliveryreference'],
    identifierType: ['identifiertype'],
    mappingStatus: ['mappingstatus'],
    compatibilitySummary: ['compatibilitysummary'],
    criticalIssue: ['criticalissue'],
    requiredAction: ['requiredaction'],
    sourceNo: ['sourceno', 'no', 'row', 'sourcerownumber'],
    notes: ['notes', 'note'],
    batteryCode: ['batteryreference', 'batterycode', 'code', 'sku', 'batterycodeoralias'],
    deviceBrand: ['devicebrand', 'brand'],
    deviceSeries: ['seriesfamily', 'series', 'family'],
    deviceModel: ['marketingname', 'devicemodel', 'model', 'phonemodel'],
    modelNumber: ['exactmodelnumber', 'modelnumber'],
    variant: ['variant'],
    evidenceStatus: ['evidencestatus'],
    evidenceSource: ['evidencesource', 'source'],
    evidenceUrl: ['sourceurl', 'evidenceurl', 'url'],
    condition: ['conditionconflict', 'condition', 'conflict'],
    claimId: ['claimid'],
    quantity: ['quantity', 'quantityreceived', 'qty', 'stockonhand'],
    unitCostUgx: ['unitcostugx', 'unitcost', 'costugx', 'cost'],
    locationCode: ['locationcode', 'location', 'stocklocation'],
    countedQuantity: ['countedquantity', 'counted', 'count'],
    reason: ['reason'],
    retailPriceUgx: ['retailpriceugx', 'retailprice', 'price', 'priceugx'],
  };
  const out: ImportMapping = {};
  const taken = new Set<string>();
  for (const field of IMPORT_FIELDS[importType]) {
    const wants = synonyms[field.key] ?? [field.key.toLowerCase()];
    const hit = sourceColumns.find((c) => !taken.has(c) && wants.includes(norm(c)));
    if (hit) {
      out[field.key] = hit;
      taken.add(hit);
    }
  }
  return out;
}

export type ProposedAction =
  | 'CREATE_BATTERY' | 'UPDATE_BATTERY' | 'HOLD_COMPOUND' | 'HOLD_CONFLICT' | 'HOLD_REVIEW'
  | 'CREATE_CLAIM' | 'UPDATE_CLAIM' | 'SKIP_CLAIM'
  | 'RECEIPT' | 'COUNT' | 'PRICE' | 'INVALID';

export interface NormalisedRow {
  rowKey: string;
  action: ProposedAction;
  value: Record<string, unknown> | null;
  warnings: string[];
  errors: string[];
  /** Why the row is held, when it is. */
  hold: string | null;
}

/** Context the preview needs about the catalogue as it stands. Provided by the repository. */
export interface CatalogueContext {
  /** normalised canonical code or active alias → product id */
  resolveBattery(code: string): { productId: string; canonicalCode: string; lifecycle: string } | { ambiguous: string[] } | null;
  /** Existing compatibility for (product, device identity) if any. */
  findClaim(productId: string, device: { brand: string; model: string; modelNumber: string | null; variant: string | null }): { id: string; workflowStatus: string } | null;
  locationExists(code: string): boolean;
  /** movement already applied with this reference for this product */
  receiptAlreadyApplied(productId: string, reference: string | null, quantity: number): boolean;
  currentStock(productId: string): number | null;
}

const PENDING = /pending|missing|required|unknown|tbc|n\/a|^-$/i;
const cleanText = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const pendingToNull = (v: string): string | null => (v && !PENDING.test(v) ? v : null);

function parseInteger(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[,\s]/g, ''));
  return Number.isInteger(n) ? n : null;
}

function parseVoltageMv(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  // Accept volts (3.85) or millivolts (3850).
  return n < 100 ? Math.round(n * 1000) : Math.round(n);
}

function parseCategory(v: string): BatteryCategory {
  const t = v.toLowerCase();
  if (/mifi|router|wifi/.test(t)) return 'MIFI_ROUTER';
  if (/other/.test(t)) return 'OTHER';
  return 'PHONE';
}

function parseChemistry(v: string): BatteryChemistry | null {
  const t = v.toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return null;
  if (t.includes('polymer') || t === 'lipo') return 'LI_POLYMER';
  if (t.includes('liion') || t === 'lithiumion' || t === 'li') return 'LI_ION';
  if (t.includes('nimh')) return 'NIMH';
  return 'OTHER';
}

function parseEvidence(v: string): CompatEvidenceStatus | null {
  const t = v.toUpperCase().replace(/[^A-Z]/g, '');
  const exact = (COMPAT_EVIDENCE_STATUSES as readonly string[]).find((s) => s.replace(/_/g, '') === t);
  if (exact) return exact as CompatEvidenceStatus;
  if (/PACKAGE|PACKAGING/.test(t)) return 'PACKAGE_VERIFIED';
  if (/FITTEST/.test(t)) return 'FIT_TESTED';
  return null;
}

export function normaliseImportRow(
  importType: BatteryImportType,
  source: Record<string, unknown>,
  mapping: ImportMapping,
  ctx: CatalogueContext,
): NormalisedRow {
  const get = (key: string): string => (mapping[key] ? cleanText(source[mapping[key]]) : '');
  const warnings: string[] = [];
  const errors: string[] = [];

  switch (importType) {
    case 'BATTERY_CATALOGUE': {
      const sourceItem = get('sourceItem');
      const codeCell = get('canonicalCode');
      const identifierType = get('identifierType');
      const mappingStatus = get('mappingStatus');
      const analysis = analyseSourceLine(sourceItem || codeCell);
      const category = get('batteryCategory') ? parseCategory(get('batteryCategory')) : looksLikeRouterBattery(sourceItem) ? 'MIFI_ROUTER' : 'PHONE';

      // Hold rules: compound lines, named conflicts, workbook conflict statuses.
      const codeLooksCompound = /\//.test(codeCell) || /\bAND\b/i.test(codeCell);
      const compound = analysis.kind === 'COMPOUND' || /compound/i.test(identifierType) || codeLooksCompound;
      const conflictReason = knownConflict(sourceItem) ?? knownConflict(codeCell);
      const workbookConflict = /^conflict/i.test(mappingStatus) || /invalid|incorrect|suspected/i.test(identifierType);
      const rowKeyBase = normaliseBatteryCode(codeCell && !PENDING.test(codeCell) ? codeCell : analysis.cleaned);

      if (compound) {
        // The held value uses the CREATE_BATTERY field names, so an operator
        // override of the canonical code yields a complete row rather than a
        // PHONE battery with no alias and no name.
        return { rowKey: rowKeyBase, action: 'HOLD_COMPOUND', value: { sourceItem, codes: analysis.codes, category, batteryCategory: category, aliases: [sourceItem], name: null, codeStatus: 'PROVISIONAL', lifecycleStatus: 'REVIEW' }, warnings, errors, hold: `One line combines more than one battery reference (${analysis.codes.join(' / ') || codeCell}). Split it, confirm it is one packaged cross-reference, or reject it.` };
      }
      if (conflictReason || workbookConflict) {
        return { rowKey: rowKeyBase, action: 'HOLD_CONFLICT', value: { sourceItem, category, batteryCategory: category, aliases: [sourceItem], name: null, codeStatus: 'PROVISIONAL', lifecycleStatus: 'REVIEW' }, warnings, errors, hold: conflictReason ?? `${mappingStatus || identifierType}: resolve before import.` };
      }

      // Canonical code: the workbook candidate reference when present, otherwise the cleaned label.
      let canonicalCode: string;
      let codeStatus: 'PROVISIONAL' | 'DEVICE_NAMED' | 'MISSING';
      const candidate = pendingToNull(stripCodeQualifier(codeCell));
      if (candidate && !/battery code missing/i.test(candidate)) {
        canonicalCode = candidate.toUpperCase();
        codeStatus = 'PROVISIONAL';
        if (/candidate|probable/i.test(codeCell)) warnings.push('The battery code is a candidate, not read from the pack.');
      } else if (analysis.kind === 'CODE' || analysis.kind === 'CODE_PLUS_DEVICE') {
        canonicalCode = displayCode(analysis.codes[0]);
        codeStatus = 'PROVISIONAL';
        if (canonicalCode !== analysis.codes[0]) warnings.push(`Code written as ${canonicalCode} from the label "${analysis.cleaned}"; confirm it from the pack.`);
        if (analysis.kind === 'CODE_PLUS_DEVICE') warnings.push(`Device names on the same line (${analysis.deviceText}) are not imported as compatibility; use the compatibility import.`);
      } else if (analysis.kind === 'DEVICE_NAMED' || /device-named/i.test(identifierType)) {
        canonicalCode = analysis.cleaned;
        codeStatus = 'DEVICE_NAMED';
        warnings.push('The stock identifier is a phone name; the printed battery code must be recorded before publication.');
      } else if (analysis.cleaned) {
        canonicalCode = analysis.cleaned;
        codeStatus = 'PROVISIONAL';
        warnings.push('Could not confirm this is a battery code; kept provisional.');
      } else {
        errors.push('Source item or battery code is required.');
        return { rowKey: '', action: 'INVALID', value: null, warnings, errors, hold: null };
      }
      // products.model_number is varchar(50); a longer code failed with a raw Postgres error.
      if (canonicalCode.length > 50) errors.push('Battery code is longer than 50 characters.');

      const barcode = get('barcode').replace(/\s+/g, '');
      if (barcode && !/^\d{8,14}$/.test(barcode)) errors.push('Barcode must be 8 to 14 digits.');
      const capacityMah = get('capacityMah') ? parseInteger(get('capacityMah')) : null;
      if (get('capacityMah') && (capacityMah == null || capacityMah <= 0)) errors.push('Capacity must be a whole number of mAh greater than zero.');
      const nominalVoltageMv = get('voltageV') ? parseVoltageMv(get('voltageV')) : null;
      if (get('voltageV') && nominalVoltageMv == null) errors.push('Voltage must be a number of volts.');
      const warrantyMonths = get('warrantyMonths') ? parseInteger(get('warrantyMonths')) : null;
      if (get('warrantyMonths') && (warrantyMonths == null || warrantyMonths < 0)) errors.push('Warranty must be a whole number of months.');
      const chemistry = get('chemistry') ? parseChemistry(get('chemistry')) : null;
      const brand = pendingToNull(get('brand'))?.replace(/\s*-\s*unresolved.*$/i, '') ?? null;
      const unresolvedBrand = /unresolved|probable/i.test(get('brand'));
      if (unresolvedBrand) warnings.push('Brand is unresolved in the source; the name carries no brand.');
      const displayBrand = unresolvedBrand ? null : brand;
      const name = get('name') || `${displayBrand ? `${displayBrand} ` : ''}battery ${canonicalCode}`.trim();
      const internalNotes = [
        get('compatibilitySummary') && `Compatibility summary: ${get('compatibilitySummary')}`,
        get('criticalIssue') && `Critical issue: ${get('criticalIssue')}`,
        get('requiredAction') && `Required action: ${get('requiredAction')}`,
        get('notes'),
      ].filter(Boolean).join('\n');
      const holdForReview = category === 'MIFI_ROUTER' && codeStatus !== 'PROVISIONAL' ? 'MiFi/router battery without a stable model number.' : null;
      if (category === 'MIFI_ROUTER') warnings.push('Classified as MiFi & Router Battery. "Big" and "small" are descriptions, not identifiers; capture the exact model before publication.');
      if (!mapping.canonicalCode && !mapping.sourceItem) errors.push('Map at least the source item or the battery code.');

      const existing = errors.length ? null : ctx.resolveBattery(canonicalCode);
      let action: ProposedAction = 'CREATE_BATTERY';
      if (existing && 'ambiguous' in existing) {
        errors.push(`"${canonicalCode}" resolves to more than one battery: ${existing.ambiguous.join(', ')}.`);
      } else if (existing) {
        action = 'UPDATE_BATTERY';
        warnings.push(`Updates existing battery ${existing.canonicalCode} (blank cells never overwrite recorded values; price and stock are never touched).`);
      }
      const value = {
        sourceItem: sourceItem || null,
        canonicalCode,
        codeStatus,
        supplierCode: pendingToNull(get('supplierCode')),
        barcode: barcode || null,
        batteryCategory: category,
        brand: displayBrand,
        name: name.slice(0, 255),
        capacityMah,
        nominalVoltageMv,
        chemistry,
        warrantyMonths,
        supplierName: pendingToNull(get('supplierName')),
        supplierReference: pendingToNull(get('supplierReference')),
        internalNotes: internalNotes || null,
        sourceNo: get('sourceNo') || null,
        identifierType: identifierType || null,
        mappingStatus: mappingStatus || null,
        lifecycleStatus: holdForReview || codeStatus === 'DEVICE_NAMED' ? 'REVIEW' : 'DRAFT',
        aliases: Array.from(new Set([sourceItem, analysis.cleaned].filter((a) => a && normaliseBatteryCode(a) !== normaliseBatteryCode(canonicalCode)))),
      };
      return { rowKey: normaliseBatteryCode(canonicalCode), action: errors.length ? 'INVALID' : action, value: errors.length ? null : value, warnings, errors, hold: null };
    }

    case 'COMPATIBILITY': {
      const batteryCode = get('batteryCode');
      const deviceBrand = get('deviceBrand');
      const deviceSeries = pendingToNull(get('deviceSeries'));
      const deviceModelRaw = get('deviceModel');
      const modelNumber = pendingToNull(get('modelNumber').replace(/\s+family$/i, ''));
      const variant = pendingToNull(get('variant'));
      const condition = get('condition');
      const evidenceCell = get('evidenceStatus');
      const evidenceSource = get('evidenceSource');
      const evidenceUrl = get('evidenceUrl');

      if (!batteryCode) errors.push('Battery code is required.');
      if (!deviceBrand) errors.push('Device brand is required.');
      const modelPending = PENDING.test(deviceModelRaw) || /device code|marketing name pending/i.test(deviceModelRaw) || /device code/i.test(deviceSeries ?? '');
      const deviceModel = modelPending ? null : deviceModelRaw || null;
      if (!deviceModel && !modelNumber) errors.push('A marketing name or an exact model number is required.');

      if (/\//.test(batteryCode) || /^HOLD-SPLIT/i.test(batteryCode) || /\bAND\b/i.test(batteryCode)) {
        return { rowKey: `${normaliseBatteryCode(batteryCode)}|${normaliseDeviceToken(deviceBrand)}|${normaliseDeviceToken(deviceModel ?? modelNumber ?? '')}`, action: 'HOLD_COMPOUND', value: null, warnings, errors, hold: `The battery reference "${batteryCode}" is a compound line; split the battery first.` };
      }
      const conflict = knownConflict(batteryCode) ?? knownConflict(`${deviceBrand} ${deviceModelRaw}`) ?? (/conflict|ambiguous/i.test(evidenceCell) || /must not share|conflict|resolve conflict|cross-brand/i.test(condition) ? condition || evidenceCell : null);
      if (conflict) {
        return { rowKey: `${normaliseBatteryCode(batteryCode)}|${normaliseDeviceToken(deviceBrand)}|${normaliseDeviceToken(deviceModel ?? modelNumber ?? '')}`, action: 'HOLD_CONFLICT', value: null, warnings, errors, hold: conflict };
      }

      // Evidence: an import can assert package/fit evidence only with a source; it never publishes.
      let evidenceStatus: CompatEvidenceStatus = 'SUPPLIER_LISTED';
      const parsed = evidenceCell ? parseEvidence(evidenceCell) : null;
      if (parsed === 'PACKAGE_VERIFIED' || parsed === 'FIT_TESTED') {
        if (!evidenceSource) errors.push(`${parsed} needs an evidence source.`);
        else evidenceStatus = parsed;
      } else if (parsed === 'VERIFIED_EXACT' || parsed === 'CONDITIONAL' || parsed === 'REJECTED') {
        warnings.push(`"${evidenceCell}" cannot be set by an import; the claim is staged as supplier listed for a verifier to decide.`);
      }

      const battery = batteryCode && !errors.length ? ctx.resolveBattery(stripCodeQualifier(batteryCode)) : null;
      if (!errors.length) {
        if (!battery) errors.push(`No battery for "${batteryCode}". Import the catalogue first or add "${batteryCode}" as an alias of the right battery.`);
        else if ('ambiguous' in battery) errors.push(`"${batteryCode}" resolves to more than one battery.`);
      }
      let action: ProposedAction = 'CREATE_CLAIM';
      if (battery && !('ambiguous' in battery)) {
        const existing = ctx.findClaim(battery.productId, { brand: deviceBrand, model: deviceModel ?? modelNumber ?? '', modelNumber, variant });
        if (existing && (existing.workflowStatus === 'READY' || existing.workflowStatus === 'ACTIVE')) {
          action = 'SKIP_CLAIM';
          warnings.push('A verified or live claim already exists for this battery and device; the import does not change it.');
        } else if (existing) action = 'UPDATE_CLAIM';
      }
      const rowKey = `${normaliseBatteryCode(batteryCode)}|${normaliseDeviceToken(deviceBrand)}|${normaliseDeviceToken(deviceModel ?? '')}|${normaliseDeviceToken(modelNumber ?? '')}|${normaliseDeviceToken(variant ?? '')}`;
      const value = {
        batteryProductId: battery && !('ambiguous' in battery) ? battery.productId : null,
        batteryCode,
        deviceBrand,
        deviceSeries,
        deviceModel: deviceModel ?? modelNumber,
        modelNumber,
        variant,
        evidenceStatus,
        evidenceSource: [evidenceSource, evidenceUrl].filter(Boolean).join(' ').slice(0, 300) || null,
        notes: [evidenceCell && `Source evidence status: ${evidenceCell}`, condition && `Condition: ${condition}`, get('claimId') && `Claim ${get('claimId')}`].filter(Boolean).join('\n') || null,
        sourceNo: get('sourceNo') || null,
      };
      return { rowKey, action: errors.length ? 'INVALID' : action, value: errors.length ? null : value, warnings, errors, hold: null };
    }

    case 'STOCK_RECEIPT': {
      const code = get('batteryCode');
      const quantity = parseInteger(get('quantity'));
      const unitCostUgx = get('unitCostUgx') ? parseInteger(get('unitCostUgx')) : null;
      const supplierName = get('supplierName');
      const supplierReference = get('supplierReference') || null;
      const locationCode = get('locationCode') || null;
      if (!code) errors.push('Battery code is required.');
      if (quantity == null || quantity <= 0) errors.push('Quantity must be a whole number greater than zero.');
      if (get('unitCostUgx') && (unitCostUgx == null || unitCostUgx < 0)) errors.push('Unit cost must be a whole number of shillings.');
      if (!supplierName) errors.push('Supplier is required.');
      if (locationCode && !ctx.locationExists(locationCode)) errors.push(`Unknown stock location "${locationCode}".`);
      const battery = code ? ctx.resolveBattery(code) : null;
      if (code && !battery) errors.push(`No battery for "${code}".`);
      if (battery && 'ambiguous' in battery) errors.push(`"${code}" matches more than one battery.`);
      const productId = battery && !('ambiguous' in battery) ? battery.productId : null;
      let hold: string | null = null;
      if (productId && quantity && ctx.receiptAlreadyApplied(productId, supplierReference, quantity)) {
        hold = `A receipt of ${quantity} for this battery with reference "${supplierReference ?? 'none'}" was already applied; excluded to avoid a duplicate.`;
      }
      const rowKey = `${normaliseBatteryCode(code)}|${(supplierReference ?? '').toUpperCase()}|${quantity ?? ''}`;
      const value = { productId, code, quantity, unitCostUgx, supplierName, supplierReference, locationCode, notes: get('notes') || null };
      return { rowKey, action: errors.length ? 'INVALID' : hold ? 'HOLD_REVIEW' : 'RECEIPT', value: errors.length ? null : value, warnings, errors, hold };
    }

    case 'STOCK_COUNT': {
      const code = get('batteryCode');
      const counted = parseInteger(get('countedQuantity'));
      const reason = get('reason') || null;
      const locationCode = get('locationCode') || null;
      if (!code) errors.push('Battery code is required.');
      if (counted == null || counted < 0) errors.push('Counted quantity must be a whole number, zero or more.');
      if (locationCode && !ctx.locationExists(locationCode)) errors.push(`Unknown stock location "${locationCode}".`);
      const battery = code ? ctx.resolveBattery(code) : null;
      if (code && !battery) errors.push(`No battery for "${code}".`);
      if (battery && 'ambiguous' in battery) errors.push(`"${code}" matches more than one battery.`);
      const productId = battery && !('ambiguous' in battery) ? battery.productId : null;
      const system = productId ? ctx.currentStock(productId) : null;
      if (productId && system != null && counted != null && counted !== system && !reason) errors.push(`Count ${counted} differs from the system ${system}; a reason is required.`);
      if (productId && system != null && counted === system) warnings.push('Count matches the system; a zero-difference count movement will be recorded.');
      const rowKey = `${normaliseBatteryCode(code)}|COUNT`;
      const value = { productId, code, countedQuantity: counted, systemQuantity: system, reason, locationCode };
      return { rowKey, action: errors.length ? 'INVALID' : 'COUNT', value: errors.length ? null : value, warnings, errors, hold: null };
    }

    case 'PRICE_UPDATE': {
      const code = get('batteryCode');
      const price = parseInteger(get('retailPriceUgx'));
      if (!code) errors.push('Battery code is required.');
      if (price == null || price <= 0) errors.push('Retail price must be a whole number of shillings greater than zero.');
      const battery = code ? ctx.resolveBattery(code) : null;
      if (code && !battery) errors.push(`No battery for "${code}".`);
      if (battery && 'ambiguous' in battery) errors.push(`"${code}" matches more than one battery.`);
      const productId = battery && !('ambiguous' in battery) ? battery.productId : null;
      return { rowKey: `${normaliseBatteryCode(code)}|PRICE`, action: errors.length ? 'INVALID' : 'PRICE', value: errors.length ? null : { productId, code, retailPriceUgx: price }, warnings, errors, hold: null };
    }
  }
}

/** Duplicate row keys inside one file are reported on every duplicate after the first. */
export function markDuplicateKeys(rows: Array<{ rowKey: string; action: ProposedAction; errors: string[] }>): void {
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!r.rowKey || r.action === 'INVALID') return;
    const first = seen.get(r.rowKey);
    if (first == null) seen.set(r.rowKey, i);
    else {
      r.errors.push(`Duplicate of row ${first + 1} within the file.`);
      r.action = 'INVALID';
    }
  });
}

export function previewDigest(rows: Array<{ rowNumber: number; action: string; value: unknown; errors: string[]; warnings: string[]; hold: string | null }>): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

/** Session status transitions, mirroring pim_import_sessions. */
export const IMPORT_TERMINAL = new Set(['APPLIED', 'PARTIALLY_APPLIED', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_PARTIAL', 'REJECTED']);

export function isValidCategory(v: string): v is BatteryCategory {
  return (BATTERY_CATEGORIES as readonly string[]).includes(v);
}
export function isValidChemistry(v: string): v is BatteryChemistry {
  return (BATTERY_CHEMISTRIES as readonly string[]).includes(v);
}
