import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { IMPORT_FIELDS, markDuplicateKeys, normaliseImportRow, suggestMapping, validateMapping, type CatalogueContext } from '../../apps/api/src/domain/batteries/BatteryImport';
import { XlsxSpreadsheetParser } from '../../apps/api/src/infrastructure/batteries/XlsxSpreadsheetParser';

/**
 * Regression fixtures for the 2026-08-26 source list (brief §8): compound
 * codes are HELD, named conflicts are HELD, MiFi lines are reclassified, and
 * nothing invents a quantity, price or specification.
 */

const COMPOUND_LINES = ['GP-15GI/4LT', 'GP-49CI / CT', 'GP-49LT/49LX', 'GP-20NT/NI', 'GP-29FT/FI', 'GP-38CT/CI', 'GP-34DT/30VX', 'GP-15FI/FT', 'GP-11DI/DT', 'GP-19CI/CT'];
const CONFLICT_LINES = ['GP-NOTE 4 EDGE', 'GP-NOTE 4 EDGE PLUS', 'GP-39LT9 SPARK 4/A56', 'GP-OPPO A57', 'GP-A03/A04', 'GP-49FX POP5/SMART 6 AND 7'];
const MIFI_LINES = ['GP- DC3650 WIFI BIG', 'GP-4G WIFI SMALL'];

const emptyContext: CatalogueContext = {
  resolveBattery: () => null,
  findClaim: () => null,
  locationExists: () => true,
  receiptAlreadyApplied: () => false,
  currentStock: () => null,
};

const rawMapping = { sourceItem: 'ITEM' };

describe('raw stock list import (BATTERIES (2).xlsx shape: NO | CATEGORY | ITEM)', () => {
  it('holds every compound battery line instead of importing it as one battery', () => {
    for (const item of COMPOUND_LINES) {
      const row = normaliseImportRow('BATTERY_CATALOGUE', { ITEM: item }, rawMapping, emptyContext);
      expect(row.action, item).toBe('HOLD_COMPOUND');
      expect(row.hold, item).toMatch(/combines more than one/);
      expect(row.value?.codes ?? [], item).toHaveLength(2);
    }
  });

  it('holds the six known conflicts for manual review', () => {
    for (const item of CONFLICT_LINES) {
      const row = normaliseImportRow('BATTERY_CATALOGUE', { ITEM: item }, rawMapping, emptyContext);
      expect(row.action, item).toBe('HOLD_CONFLICT');
      expect(row.hold, item).toBeTruthy();
    }
  });

  it('reclassifies MiFi and router labels and keeps them out of publication', () => {
    for (const item of MIFI_LINES) {
      const row = normaliseImportRow('BATTERY_CATALOGUE', { ITEM: item }, rawMapping, emptyContext);
      expect(row.action, item).toBe('CREATE_BATTERY');
      expect(row.value?.batteryCategory, item).toBe('MIFI_ROUTER');
      expect(row.warnings.join(' '), item).toMatch(/descriptions, not identifiers/);
    }
  });

  it('imports a plain reference as a provisional draft with the shop label as an alias', () => {
    const row = normaliseImportRow('BATTERY_CATALOGUE', { ITEM: 'GP-49FT' }, rawMapping, emptyContext);
    expect(row.action).toBe('CREATE_BATTERY');
    expect(row.value).toMatchObject({ canonicalCode: 'BL-49FT', codeStatus: 'PROVISIONAL', batteryCategory: 'PHONE', lifecycleStatus: 'DRAFT' });
    expect(row.value?.aliases).toContain('GP-49FT');
  });

  it('keeps a device-named line as a draft that cannot be published until the code is recorded', () => {
    const row = normaliseImportRow('BATTERY_CATALOGUE', { ITEM: 'GP-IP 11 PRO' }, rawMapping, emptyContext);
    expect(row.action).toBe('CREATE_BATTERY');
    expect(row.value).toMatchObject({ codeStatus: 'DEVICE_NAMED', lifecycleStatus: 'REVIEW' });
  });

  it('never invents a quantity, price or specification', () => {
    const row = normaliseImportRow('BATTERY_CATALOGUE', { ITEM: 'GP-49FT' }, rawMapping, emptyContext);
    expect(row.value).toMatchObject({ capacityMah: null, nominalVoltageMv: null, warrantyMonths: null, barcode: null });
    expect(row.value).not.toHaveProperty('priceUgx');
    expect(row.value).not.toHaveProperty('quantity');
  });
});

describe('audit workbook import (01 Battery Master and 02 Compatibility Map)', () => {
  const masterMapping = { sourceNo: 'Source No.', sourceItem: 'Raw Inventory Item', canonicalCode: 'Candidate Battery Reference', batteryCategory: 'Product Type', brand: 'Customer Brand', identifierType: 'Identifier Type', mappingStatus: 'Mapping Status', criticalIssue: 'Critical Issue', requiredAction: 'Required Action' };

  it('suggests the workbook mapping from its headers', () => {
    const suggested = suggestMapping('BATTERY_CATALOGUE', ['Source No.', 'Raw Inventory Item', 'Provisional SKU', 'Product Type', 'Customer Brand', 'Candidate Battery Reference', 'Compatibility Summary', 'Identifier Type', 'Mapping Status', 'Critical Issue', 'Required Action', 'Publish Status', 'Quantity On Hand', 'Retail Price UGX', 'Barcode', 'Capacity mAh', 'Voltage V', 'Warranty Months']);
    expect(suggested.sourceItem).toBe('Raw Inventory Item');
    expect(suggested.canonicalCode).toBe('Candidate Battery Reference');
    expect(suggested.batteryCategory).toBe('Product Type');
    expect(suggested.capacityMah).toBe('Capacity mAh');
    expect(validateMapping('BATTERY_CATALOGUE', suggested, Object.values(suggested))).toEqual([]);
  });

  it('takes the candidate reference as a provisional code and flags candidates', () => {
    const row = normaliseImportRow('BATTERY_CATALOGUE', { 'Raw Inventory Item': 'GP-A20/A30/A50', 'Candidate Battery Reference': 'EB-BA505ABU (candidate)', 'Product Type': 'Phone Battery', 'Customer Brand': 'Samsung', 'Identifier Type': 'Multiple device names', 'Mapping Status': 'Mapped - provisional' }, masterMapping, emptyContext);
    expect(row.action).toBe('CREATE_BATTERY');
    expect(row.value).toMatchObject({ canonicalCode: 'EB-BA505ABU', codeStatus: 'PROVISIONAL', brand: 'Samsung' });
    expect(row.warnings.join(' ')).toMatch(/candidate/);
  });

  it('holds a workbook conflict row even when the label itself looks harmless', () => {
    const row = normaliseImportRow('BATTERY_CATALOGUE', { 'Raw Inventory Item': 'GP-38BT', 'Candidate Battery Reference': 'BL-38BT', 'Product Type': 'Phone Battery', 'Customer Brand': 'TECNO', 'Identifier Type': 'Battery reference only', 'Mapping Status': 'Conflict - resolve' }, masterMapping, emptyContext);
    expect(row.action).toBe('HOLD_CONFLICT');
  });

  it('a compound reference is held by the code cell too', () => {
    const row = normaliseImportRow('BATTERY_CATALOGUE', { 'Raw Inventory Item': 'GP-49CI / CT', 'Candidate Battery Reference': 'BL-49CI / BL-49CT', 'Identifier Type': 'Compound battery reference', 'Mapping Status': 'Conflict - split required' }, masterMapping, emptyContext);
    expect(row.action).toBe('HOLD_COMPOUND');
  });

  const claimMapping = { claimId: 'Claim ID', batteryCode: 'Battery Reference', deviceBrand: 'Device Brand', deviceSeries: 'Series / Family', deviceModel: 'Marketing Name', modelNumber: 'Exact Model Number', evidenceStatus: 'Evidence Status', evidenceSource: 'Evidence Source', evidenceUrl: 'Source URL', condition: 'Condition / Conflict' };
  const withBattery: CatalogueContext = { ...emptyContext, resolveBattery: (code) => (/49FT/i.test(code) ? { productId: 'p-49ft', canonicalCode: 'BL-49FT', lifecycle: 'DRAFT' } : null) };

  it('stages a compatibility claim as supplier listed, never verified, with the exact model number kept separate', () => {
    const row = normaliseImportRow('COMPATIBILITY', { 'Claim ID': '36', 'Battery Reference': 'BL-49FT', 'Device Brand': 'TECNO', 'Series / Family': 'Spark', 'Marketing Name': 'Spark 7', 'Exact Model Number': 'KF6n', 'Evidence Status': 'Supplier cross-check', 'Evidence Source': 'All Spares', 'Source URL': 'https://all-spares.com/x' }, claimMapping, withBattery);
    expect(row.action).toBe('CREATE_CLAIM');
    expect(row.value).toMatchObject({ batteryProductId: 'p-49ft', deviceBrand: 'TECNO', deviceSeries: 'Spark', deviceModel: 'Spark 7', modelNumber: 'KF6n', evidenceStatus: 'SUPPLIER_LISTED' });
  });

  it('treats "pending" model numbers as blank and refuses a claim with no battery', () => {
    const pending = normaliseImportRow('COMPATIBILITY', { 'Battery Reference': 'BL-49FT', 'Device Brand': 'TECNO', 'Marketing Name': 'Spark 8 Pro', 'Exact Model Number': 'Exact code pending' }, claimMapping, withBattery);
    expect(pending.value?.modelNumber).toBeNull();
    const missing = normaliseImportRow('COMPATIBILITY', { 'Battery Reference': 'BL-99ZZ', 'Device Brand': 'TECNO', 'Marketing Name': 'Spark 8 Pro' }, claimMapping, withBattery);
    expect(missing.action).toBe('INVALID');
    expect(missing.errors[0]).toMatch(/No battery for/);
  });

  it('holds the compound and cross-brand claims from the map', () => {
    const compound = normaliseImportRow('COMPATIBILITY', { 'Battery Reference': 'BL-49LT / BL-49LX', 'Device Brand': 'Infinix', 'Marketing Name': 'Hot 12', 'Evidence Status': 'Poster claim for BL-49LX only' }, claimMapping, withBattery);
    expect(compound.action).toBe('HOLD_COMPOUND');
    const cross = normaliseImportRow('COMPATIBILITY', { 'Battery Reference': 'BL-49FX', 'Device Brand': 'Infinix', 'Marketing Name': 'Smart 6', 'Evidence Status': 'Inventory claim - unverified', 'Condition / Conflict': 'Cross-brand claim requires individual verification.' }, claimMapping, withBattery);
    expect(cross.action).toBe('HOLD_CONFLICT');
  });

  it('a verified evidence status in a spreadsheet cannot publish anything', () => {
    const row = normaliseImportRow('COMPATIBILITY', { 'Battery Reference': 'BL-49FT', 'Device Brand': 'TECNO', 'Marketing Name': 'Spark 7', 'Evidence Status': 'VERIFIED_EXACT' }, claimMapping, withBattery);
    expect(row.value?.evidenceStatus).toBe('SUPPLIER_LISTED');
    expect(row.warnings.join(' ')).toMatch(/cannot be set by an import/);
  });

  it('a claim for a verified or live pair is skipped, never changed', () => {
    const ctx: CatalogueContext = { ...withBattery, findClaim: () => ({ id: 'c1', workflowStatus: 'ACTIVE' }) };
    const row = normaliseImportRow('COMPATIBILITY', { 'Battery Reference': 'BL-49FT', 'Device Brand': 'TECNO', 'Marketing Name': 'Spark 7' }, claimMapping, ctx);
    expect(row.action).toBe('SKIP_CLAIM');
  });
});

describe('stock, count and price rows', () => {
  const ctx: CatalogueContext = { ...emptyContext, resolveBattery: (code) => (/49FT/i.test(code) ? { productId: 'p', canonicalCode: 'BL-49FT', lifecycle: 'ACTIVE' } : null), currentStock: () => 4, receiptAlreadyApplied: (_p, ref) => ref === 'INV-1' };
  const receiptMapping = { batteryCode: 'code', quantity: 'qty', supplierName: 'supplier', supplierReference: 'ref', unitCostUgx: 'cost' };

  it('a receipt needs a positive quantity and a supplier, and a repeated reference is held', () => {
    expect(normaliseImportRow('STOCK_RECEIPT', { code: 'BL-49FT', qty: '10', supplier: 'Acme', ref: 'INV-2', cost: '30000' }, receiptMapping, ctx)).toMatchObject({ action: 'RECEIPT', value: { productId: 'p', quantity: 10, unitCostUgx: 30000 } });
    expect(normaliseImportRow('STOCK_RECEIPT', { code: 'BL-49FT', qty: '0', supplier: 'Acme' }, receiptMapping, ctx).action).toBe('INVALID');
    expect(normaliseImportRow('STOCK_RECEIPT', { code: 'BL-49FT', qty: '10', supplier: '' }, receiptMapping, ctx).errors.join(' ')).toMatch(/Supplier/);
    const dup = normaliseImportRow('STOCK_RECEIPT', { code: 'BL-49FT', qty: '10', supplier: 'Acme', ref: 'INV-1' }, receiptMapping, ctx);
    expect(dup.action).toBe('HOLD_REVIEW');
    expect(dup.hold).toMatch(/already applied/);
  });

  it('a count that differs from the system needs a reason', () => {
    const m = { batteryCode: 'code', countedQuantity: 'counted', reason: 'reason' };
    expect(normaliseImportRow('STOCK_COUNT', { code: 'BL-49FT', counted: '4' }, m, ctx).action).toBe('COUNT');
    expect(normaliseImportRow('STOCK_COUNT', { code: 'BL-49FT', counted: '2' }, m, ctx).action).toBe('INVALID');
    expect(normaliseImportRow('STOCK_COUNT', { code: 'BL-49FT', counted: '2', reason: 'Two damaged' }, m, ctx).action).toBe('COUNT');
  });

  it('a price below the storefront floor is refused', () => {
    const m = { batteryCode: 'code', retailPriceUgx: 'price' };
    expect(normaliseImportRow('PRICE_UPDATE', { code: 'BL-49FT', price: '145000' }, m, ctx).action).toBe('PRICE');
    expect(normaliseImportRow('PRICE_UPDATE', { code: 'BL-49FT', price: '60000' }, m, ctx).errors.join(' ')).toMatch(/below the storefront floor/);
  });

  it('duplicate row keys inside one file are refused after the first', () => {
    const rows = [
      { rowKey: 'BL49FT', action: 'CREATE_BATTERY' as const, errors: [] as string[] },
      { rowKey: 'BL49FT', action: 'CREATE_BATTERY' as const, errors: [] as string[] },
    ];
    markDuplicateKeys(rows);
    expect(rows[1].action).toBe('INVALID');
    expect(rows[1].errors[0]).toMatch(/Duplicate of row 1/);
  });

  it('every import type declares its fields and required ones are enforced by the mapping validator', () => {
    for (const type of Object.keys(IMPORT_FIELDS) as Array<keyof typeof IMPORT_FIELDS>) expect(IMPORT_FIELDS[type].length).toBeGreaterThan(0);
    expect(validateMapping('STOCK_RECEIPT', {}, ['a'])).toEqual(expect.arrayContaining([expect.stringMatching(/Battery code/), expect.stringMatching(/Quantity/)]));
    expect(validateMapping('STOCK_RECEIPT', { batteryCode: 'a', quantity: 'a', supplierName: 'b' }, ['a', 'b'])).toEqual(expect.arrayContaining([expect.stringMatching(/one target field only/)]));
  });
});

describe('spreadsheet parser', () => {
  it('reads a workbook with a title banner, keeps formulas as data and never evaluates them', () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['01 · BATTERY MASTER', '01 · BATTERY MASTER'],
      ['Source No.', 'Raw Inventory Item', 'Candidate Battery Reference'],
      [1, 'GP-49FT', 'BL-49FT'],
      [2, '=HYPERLINK("http://evil","x")', 'BL-49JT'],
      [3, 'GP-IP X', ''],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, '01 Battery Master');
    const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    const parsed = new XlsxSpreadsheetParser().parse(buffer, 'audit.xlsx', null);
    expect(parsed.sheetName).toBe('01 Battery Master');
    expect(parsed.columns).toEqual(['Source No.', 'Raw Inventory Item', 'Candidate Battery Reference']);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]['Raw Inventory Item']).toBe('GP-49FT');
    expect(parsed.rows[1]['Raw Inventory Item']).toMatch(/^=HYPERLINK|^$/);
    expect(parsed.rows[2]['Raw Inventory Item']).toBe('GP-IP X');
  });

  it('reads a CSV as text', () => {
    const csv = 'code,qty,supplier\nBL-49FT,10,Acme\n"BL-49JT",5,"Beta, Ltd"\n';
    const parsed = new XlsxSpreadsheetParser().parse(Buffer.from(csv), 'receipt.csv', null);
    expect(parsed.columns).toEqual(['code', 'qty', 'supplier']);
    expect(parsed.rows[1]).toEqual({ code: 'BL-49JT', qty: '5', supplier: 'Beta, Ltd' });
  });
});
