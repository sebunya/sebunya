import { DEVICE_CONFIDENCE, DEVICE_FIT_TYPES, DeviceConfidence, DeviceFitType } from './Devices';

/**
 * Bulk compatibility import validation (U2 AC5). Pure domain.
 *
 * The whole file is validated before ANY canonical row is committed (the repo
 * runs the commit in one transaction only if this returns zero errors). Every
 * invalid row is reported with its row number, the offending column and a
 * message — the operator fixes and re-uploads, and nothing is half-applied.
 */

export const IMPORT_BOUNDS = {
  maxRows: 5000,
  maxCellLength: 300,
  maxFileBytes: 2 * 1024 * 1024, // 2 MB
};

export interface RawCompatibilityRow {
  productRef: string; // sku or product id
  deviceRef: string;  // device slug
  fitType: string;
  confidence: string;
  evidenceSource?: string;
  notes?: string;
}

export interface ValidCompatibilityRow {
  productRef: string;
  deviceRef: string;
  fitType: DeviceFitType;
  confidence: DeviceConfidence;
  evidenceSource: string | null;
  notes: string | null;
}

export interface ImportRowError {
  row: number; // 1-based data row (excludes header)
  column: string;
  message: string;
}

export interface ImportValidationResult {
  ok: boolean;
  rows: ValidCompatibilityRow[];
  errors: ImportRowError[];
}

function tooLong(value: string | undefined): boolean {
  return !!value && value.length > IMPORT_BOUNDS.maxCellLength;
}

export function validateCompatibilityImport(
  raw: RawCompatibilityRow[],
  fileByteLength?: number,
): ImportValidationResult {
  const errors: ImportRowError[] = [];
  if (fileByteLength != null && fileByteLength > IMPORT_BOUNDS.maxFileBytes) {
    return { ok: false, rows: [], errors: [{ row: 0, column: 'file', message: `File exceeds ${IMPORT_BOUNDS.maxFileBytes} bytes.` }] };
  }
  if (raw.length === 0) {
    return { ok: false, rows: [], errors: [{ row: 0, column: 'file', message: 'No data rows.' }] };
  }
  if (raw.length > IMPORT_BOUNDS.maxRows) {
    return { ok: false, rows: [], errors: [{ row: 0, column: 'file', message: `Too many rows (max ${IMPORT_BOUNDS.maxRows}).` }] };
  }

  const rows: ValidCompatibilityRow[] = [];
  raw.forEach((r, i) => {
    const rowNum = i + 1;
    const productRef = (r.productRef ?? '').trim();
    const deviceRef = (r.deviceRef ?? '').trim();
    const fitType = (r.fitType ?? '').trim().toLowerCase();
    const confidence = (r.confidence ?? '').trim().toLowerCase();
    const evidenceSource = (r.evidenceSource ?? '').trim();
    const notes = (r.notes ?? '').trim();

    if (!productRef) errors.push({ row: rowNum, column: 'productRef', message: 'Product reference is required.' });
    if (!deviceRef) errors.push({ row: rowNum, column: 'deviceRef', message: 'Device reference is required.' });
    if (!DEVICE_FIT_TYPES.includes(fitType as DeviceFitType)) errors.push({ row: rowNum, column: 'fitType', message: `fit_type must be one of ${DEVICE_FIT_TYPES.join(', ')}.` });
    if (!DEVICE_CONFIDENCE.includes(confidence as DeviceConfidence)) errors.push({ row: rowNum, column: 'confidence', message: `confidence must be one of ${DEVICE_CONFIDENCE.join(', ')}.` });
    // Verified compatibility must carry its evidence source.
    if (confidence === 'verified' && !evidenceSource) errors.push({ row: rowNum, column: 'evidenceSource', message: 'Verified compatibility requires an evidence source.' });
    if (tooLong(evidenceSource)) errors.push({ row: rowNum, column: 'evidenceSource', message: `Exceeds ${IMPORT_BOUNDS.maxCellLength} characters.` });
    if (tooLong(notes)) errors.push({ row: rowNum, column: 'notes', message: `Exceeds ${IMPORT_BOUNDS.maxCellLength} characters.` });

    if (!errors.some((e) => e.row === rowNum)) {
      rows.push({
        productRef,
        deviceRef,
        fitType: fitType as DeviceFitType,
        confidence: confidence as DeviceConfidence,
        evidenceSource: evidenceSource || null,
        notes: notes || null,
      });
    }
  });

  return { ok: errors.length === 0, rows: errors.length === 0 ? rows : [], errors };
}
