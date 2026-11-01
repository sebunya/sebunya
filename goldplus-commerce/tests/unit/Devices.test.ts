import { describe, expect, it } from 'vitest';
import { normaliseDeviceToken, deviceSlug, normaliseAliases, resolveDeviceQuery, DeviceAliasCandidate } from '../../apps/api/src/domain/products/Devices';
import { validateCompatibilityImport, IMPORT_BOUNDS } from '../../apps/api/src/domain/products/DeviceCompatibilityImport';

describe('U2 device normalisation and alias resolution (AC2)', () => {
  it('normalises punctuation/case/spacing without erasing the display value', () => {
    expect(normaliseDeviceToken('Spark 20 Pro+')).toBe('spark 20 pro plus');
    expect(normaliseDeviceToken('  Redmi-Note  13 ')).toBe('redmi note 13');
    expect(normaliseDeviceToken('Spark 20 Pro+')).toBe(normaliseDeviceToken('spark-20 pro plus'));
  });

  it('builds a stable slug', () => {
    expect(deviceSlug('Tecno', 'Spark 20 Pro+')).toBe('tecno-spark-20-pro-plus');
  });

  it('dedupes normalised aliases', () => {
    expect(normaliseAliases(['Spark 20', 'spark-20', 'SPARK  20'])).toEqual(['spark 20']);
  });

  const devices: DeviceAliasCandidate[] = [
    { id: 'd-spark20', brandNormalised: 'tecno', modelNormalised: 'spark 20', aliasesNormalised: ['tecno spark 20', 'spark twenty'], isActive: true },
    { id: 'd-spark20pro', brandNormalised: 'tecno', modelNormalised: 'spark 20 pro', aliasesNormalised: [], isActive: true },
    { id: 'd-redmi', brandNormalised: 'xiaomi', modelNormalised: 'redmi note 13', aliasesNormalised: ['redmi note 13'], isActive: true },
  ];

  it('resolves "charger for Tecno Spark 20" to the single matching device', () => {
    expect(resolveDeviceQuery('Tecno Spark 20', devices)).toEqual({ kind: 'RESOLVED', deviceId: 'd-spark20' });
    expect(resolveDeviceQuery('spark twenty', devices)).toEqual({ kind: 'RESOLVED', deviceId: 'd-spark20' });
  });

  it('returns NOT_FOUND for an unknown device', () => {
    expect(resolveDeviceQuery('Pixel 9', devices)).toEqual({ kind: 'NOT_FOUND' });
  });

  it('flags AMBIGUOUS rather than silently picking when an alias maps to multiple active models', () => {
    const ambiguous: DeviceAliasCandidate[] = [
      { id: 'a', brandNormalised: 'tecno', modelNormalised: 'camon 30', aliasesNormalised: ['camon 30'], isActive: true },
      { id: 'b', brandNormalised: 'tecno', modelNormalised: 'camon 30 5g', aliasesNormalised: ['camon 30'], isActive: true },
    ];
    expect(resolveDeviceQuery('Camon 30', ambiguous)).toEqual({ kind: 'AMBIGUOUS', deviceIds: ['a', 'b'] });
  });

  it('ignores inactive devices in resolution', () => {
    const withInactive: DeviceAliasCandidate[] = [
      { id: 'x', brandNormalised: 'tecno', modelNormalised: 'spark 20', aliasesNormalised: [], isActive: false },
    ];
    expect(resolveDeviceQuery('Spark 20', withInactive)).toEqual({ kind: 'NOT_FOUND' });
  });
});

describe('U2 bulk compatibility import validation (AC5)', () => {
  const good = { productRef: 'SKU1', deviceRef: 'tecno-spark-20', fitType: 'exact', confidence: 'declared' };

  it('accepts a fully-valid file', () => {
    const result = validateCompatibilityImport([good, { ...good, productRef: 'SKU2' }]);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('reports per-row errors and commits nothing when any row is invalid', () => {
    const result = validateCompatibilityImport([
      good,
      { productRef: '', deviceRef: 'd', fitType: 'exact', confidence: 'declared' }, // missing product
      { productRef: 'SKU3', deviceRef: 'd', fitType: 'snug', confidence: 'declared' }, // bad fit
      { productRef: 'SKU4', deviceRef: 'd', fitType: 'exact', confidence: 'verified' }, // verified w/o evidence
    ]);
    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(0); // nothing staged for commit
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 2, column: 'productRef' }));
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 3, column: 'fitType' }));
    expect(result.errors).toContainEqual(expect.objectContaining({ row: 4, column: 'evidenceSource' }));
  });

  it('enforces file, row-count and cell-length bounds', () => {
    expect(validateCompatibilityImport([], 0).errors[0].column).toBe('file');
    expect(validateCompatibilityImport([good], IMPORT_BOUNDS.maxFileBytes + 1).errors[0].message).toMatch(/exceeds/i);
    const many = Array.from({ length: IMPORT_BOUNDS.maxRows + 1 }, () => good);
    expect(validateCompatibilityImport(many).errors[0].message).toMatch(/Too many rows/);
    const longNote = validateCompatibilityImport([{ ...good, notes: 'x'.repeat(IMPORT_BOUNDS.maxCellLength + 1) }]);
    expect(longNote.errors).toContainEqual(expect.objectContaining({ column: 'notes' }));
  });
});
