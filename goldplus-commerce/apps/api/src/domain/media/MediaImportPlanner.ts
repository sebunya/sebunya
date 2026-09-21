import { createHash } from 'node:crypto';
import type { GallerySlot } from '@goldplus/shared';
import { codeKey, containsRun, tokens, type MatchableProduct } from './PhotoCodeMatcher';
import type { SlotAssignment, SlotMap } from './ProductMediaSlotMap';

/**
 * Focus 4 — reviewed bulk image import: the PLAN. Pure domain, no I/O.
 *
 * Inputs: staged files (name + content hash + whether the library has a ready
 * asset for it), an optional manifest, the catalogue's code index and each
 * matched product's current slot map + media revision. Output: a deterministic
 * plan — one row per file with a status the operator can act on, one proposed
 * slot map per product, and a stable plan hash that apply re-verifies.
 *
 * Filename convention (the numeric slot is authoritative, the suffix is descriptive):
 *   SKU__01-main.ext   SKU__02-alt.ext   SKU__03-detail.ext   SKU__04-context.ext
 * A manifest row explicitly controls its file; a disagreement between filename
 * metadata and the manifest is shown, never silently reconciled.
 */

export const IMPORTER_VERSION = 'focus4-media-import/1';

export type ImportRowStatus =
  | 'NEW'
  | 'UNCHANGED'
  | 'EXACT_DUPLICATE'
  | 'WOULD_REPLACE'
  | 'UNMATCHED_PRODUCT'
  | 'AMBIGUOUS'
  | 'DUPLICATE_SLOT'
  | 'INVALID_SLOT'
  | 'INVALID_FILE'
  | 'MANIFEST_CONFLICT';

export const BLOCKING_STATUSES: ReadonlySet<ImportRowStatus> = new Set(['UNMATCHED_PRODUCT', 'AMBIGUOUS', 'DUPLICATE_SLOT', 'INVALID_SLOT', 'INVALID_FILE', 'MANIFEST_CONFLICT']);

export interface StagedFile {
  filename: string;
  sha256: string;
  /** Library asset id when the bytes were stored (or deduplicated), null when rejected. */
  assetId: string | null;
  /** ACTIVE + rendition generated. */
  ready: boolean;
  rejectReason?: string | null;
}

export interface ManifestRow {
  sku: string;
  slot: number;
  filename: string;
  role?: string | null;
  alt_text?: string | null;
}

export interface ProductGalleryContext {
  productId: string;
  sku: string;
  mediaRevision: number;
  currentMap: SlotMap;
  /** asset id → sha256 of the assets currently in the gallery (to detect UNCHANGED / EXACT_DUPLICATE). */
  assetHashes: Record<string, string>;
}

export interface PlanRow {
  rowNumber: number;
  filename: string;
  sha256: string;
  assetId: string | null;
  skuToken: string | null;
  productId: string | null;
  productSku: string | null;
  slot: GallerySlot | null;
  role: string | null;
  altText: string | null;
  status: ImportRowStatus;
  issues: string[];
  source: 'FILENAME' | 'MANIFEST';
}

export interface ProductPlan {
  productId: string;
  sku: string;
  expectedRevision: number;
  currentMap: SlotMap;
  proposedMap: SlotMap;
  /** True when a slot that already holds a different asset would be overwritten. */
  replaces: GallerySlot[];
}

export interface ImportPlan {
  importerVersion: string;
  rows: PlanRow[];
  products: ProductPlan[];
  totals: Record<ImportRowStatus | 'TOTAL', number>;
  blocking: boolean;
  planHash: string;
}

const NAME_RE = /^(?<sku>[A-Za-z0-9][A-Za-z0-9 ._-]*?)__(?<slot>\d{1,2})(?:-(?<role>[A-Za-z0-9-]+))?\.(?<ext>[A-Za-z0-9]+)$/;
const SAFE_NAME_RE = /^[^\\/:*?"<>|\u0000-\u001f]+$/;

export function parseImportFilename(filename: string): { skuToken: string; slot: number; role: string | null } | null {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const m = base.match(NAME_RE);
  if (!m || !m.groups) return null;
  return { skuToken: m.groups.sku.trim(), slot: Number(m.groups.slot), role: m.groups.role ?? null };
}

export function isSafeFilename(filename: string): boolean {
  return SAFE_NAME_RE.test(filename) && !filename.includes('..') && filename.length <= 255;
}

/** Minimal CSV/JSON manifest reader. Header row required for CSV: sku, slot, filename, role?, alt_text?. */
export function parseManifest(text: string, kind: 'csv' | 'json'): { rows: ManifestRow[]; errors: string[] } {
  const errors: string[] = [];
  if (kind === 'json') {
    try {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : null;
      if (!list) return { rows: [], errors: ['The JSON manifest must be an array of rows (or { rows: [...] }).'] };
      return { rows: (list as Array<Record<string, unknown>>).map(normaliseManifestRow).filter((r): r is ManifestRow => r !== null), errors };
    } catch {
      return { rows: [], errors: ['The JSON manifest could not be parsed.'] };
    }
  }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: ['The CSV manifest is empty.'] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const need = ['sku', 'slot', 'filename'];
  for (const n of need) if (!header.includes(n)) errors.push(`The CSV manifest has no "${n}" column.`);
  if (errors.length) return { rows: [], errors };
  const rows: ManifestRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (name: string) => { const idx = header.indexOf(name); return idx >= 0 ? (cells[idx] ?? '').trim() : ''; };
    const r = normaliseManifestRow({ sku: get('sku'), slot: get('slot'), filename: get('filename'), role: get('role'), alt_text: get('alt_text') });
    if (r) rows.push(r);
    else errors.push(`Row ${i + 1}: sku, slot and filename are required.`);
  }
  return { rows, errors };
}

function normaliseManifestRow(raw: Record<string, unknown>): ManifestRow | null {
  const sku = String(raw.sku ?? '').trim();
  const filename = String(raw.filename ?? '').trim();
  const slot = Number(raw.slot);
  if (!sku || !filename || !Number.isFinite(slot)) return null;
  return { sku, slot, filename, role: raw.role ? String(raw.role).trim() : null, alt_text: raw.alt_text ? String(raw.alt_text).trim().slice(0, 255) : null };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Exact SKU/model resolution using the catalogue's own token rules; ambiguity is reported, never guessed. */
export function resolveSku(skuToken: string, products: readonly MatchableProduct[]): { productId: string; sku: string } | { ambiguous: string[] } | null {
  const want = codeKey(skuToken).join('');
  const hay = tokens(skuToken);
  const exact = products.filter((p) => p.codes.some((c) => codeKey(c).join('') === want));
  if (exact.length === 1) return { productId: exact[0].id, sku: exact[0].codes[0] ?? exact[0].name };
  if (exact.length > 1) return { ambiguous: exact.map((p) => p.name) };
  const contained = products.filter((p) => p.codes.some((c) => containsRun(hay, codeKey(c)) && codeKey(c).join('').length === want.length));
  if (contained.length === 1) return { productId: contained[0].id, sku: contained[0].codes[0] ?? contained[0].name };
  if (contained.length > 1) return { ambiguous: contained.map((p) => p.name) };
  return null;
}

export function buildImportPlan(input: {
  files: readonly StagedFile[];
  manifest: readonly ManifestRow[];
  products: readonly MatchableProduct[];
  galleries: readonly ProductGalleryContext[];
}): ImportPlan {
  const byProduct = new Map(input.galleries.map((g) => [g.productId, g]));
  const manifestByFile = new Map<string, ManifestRow>();
  const manifestDupes = new Set<string>();
  for (const m of input.manifest) {
    if (manifestByFile.has(m.filename)) manifestDupes.add(m.filename);
    manifestByFile.set(m.filename, m);
  }

  const rows: PlanRow[] = [];
  const seenFile = new Set<string>();
  input.files.forEach((f, i) => {
    const row: PlanRow = { rowNumber: i + 1, filename: f.filename, sha256: f.sha256, assetId: f.assetId, skuToken: null, productId: null, productSku: null, slot: null, role: null, altText: null, status: 'NEW', issues: [], source: 'FILENAME' };
    rows.push(row);
    if (!isSafeFilename(f.filename)) { row.status = 'INVALID_FILE'; row.issues.push('Unsafe filename (path characters or control characters).'); return; }
    if (seenFile.has(f.filename)) { row.status = 'INVALID_FILE'; row.issues.push('Duplicate filename in this batch.'); return; }
    seenFile.add(f.filename);
    if (!f.assetId || !f.ready) { row.status = 'INVALID_FILE'; row.issues.push(f.rejectReason ? `Rejected by the media library (${f.rejectReason}).` : 'The file could not be stored or has no rendition.'); return; }

    const fromName = parseImportFilename(f.filename);
    const manifest = manifestByFile.get(f.filename);
    if (manifest && manifestDupes.has(f.filename)) { row.status = 'MANIFEST_CONFLICT'; row.issues.push('The manifest lists this filename more than once.'); return; }
    if (manifest) {
      row.source = 'MANIFEST';
      row.skuToken = manifest.sku;
      row.role = manifest.role ?? fromName?.role ?? null;
      row.altText = manifest.alt_text ?? null;
      if (fromName && (codeKey(fromName.skuToken).join('') !== codeKey(manifest.sku).join('') || fromName.slot !== manifest.slot)) {
        row.status = 'MANIFEST_CONFLICT';
        row.issues.push(`The filename says ${fromName.skuToken} slot ${fromName.slot}; the manifest says ${manifest.sku} slot ${manifest.slot}. Fix one of them.`);
        return;
      }
      if (!Number.isInteger(manifest.slot) || manifest.slot < 1 || manifest.slot > 4) { row.status = 'INVALID_SLOT'; row.issues.push(`Slot ${manifest.slot} is not allowed (1–4).`); return; }
      row.slot = manifest.slot as GallerySlot;
    } else if (fromName) {
      row.skuToken = fromName.skuToken;
      row.role = fromName.role;
      if (fromName.slot < 1 || fromName.slot > 4) { row.status = 'INVALID_SLOT'; row.issues.push(`Slot ${fromName.slot} is not allowed (1–4).`); return; }
      row.slot = fromName.slot as GallerySlot;
    } else {
      row.status = 'INVALID_FILE';
      row.issues.push('The filename does not follow SKU__01-main.ext and no manifest row names it.');
      return;
    }

    const resolved = resolveSku(row.skuToken!, input.products);
    if (!resolved) { row.status = 'UNMATCHED_PRODUCT'; row.issues.push(`No product has the code "${row.skuToken}".`); return; }
    if ('ambiguous' in resolved) { row.status = 'AMBIGUOUS'; row.issues.push(`"${row.skuToken}" matches more than one product: ${resolved.ambiguous.join(', ')}.`); return; }
    row.productId = resolved.productId;
    row.productSku = resolved.sku;
  });

  // Per product: duplicate slots within the batch, then compare with the current gallery.
  const groups = new Map<string, PlanRow[]>();
  for (const r of rows) if (r.productId && r.slot) groups.set(r.productId, [...(groups.get(r.productId) ?? []), r]);
  const products: ProductPlan[] = [];
  for (const [productId, group] of groups) {
    const ctx = byProduct.get(productId);
    const slotsSeen = new Map<number, PlanRow>();
    for (const r of group) {
      const other = slotsSeen.get(r.slot!);
      if (other) { r.status = 'DUPLICATE_SLOT'; r.issues.push(`Slot ${r.slot} is also claimed by ${other.filename}.`); other.status = 'DUPLICATE_SLOT'; other.issues.push(`Slot ${other.slot} is also claimed by ${r.filename}.`); }
      else slotsSeen.set(r.slot!, r);
    }
    const assetSeen = new Map<string, PlanRow>();
    for (const r of group) {
      if (BLOCKING_STATUSES.has(r.status)) continue;
      const other = assetSeen.get(r.assetId!);
      if (other) { r.status = 'DUPLICATE_SLOT'; r.issues.push(`The same image (${other.filename}) is already proposed for slot ${other.slot} of this product.`); }
      else assetSeen.set(r.assetId!, r);
    }
    const currentMap = ctx?.currentMap ?? [];
    const currentBySlot = new Map(currentMap.map((a) => [a.slot, a]));
    const hashByAsset = ctx?.assetHashes ?? {};
    const proposals: SlotAssignment[] = [];
    const replaces: GallerySlot[] = [];
    for (const r of group) {
      if (BLOCKING_STATUSES.has(r.status)) continue;
      const existing = currentBySlot.get(r.slot!);
      const sameAssetElsewhere = currentMap.find((a) => a.assetId === r.assetId && a.slot !== r.slot);
      if (existing && existing.assetId === r.assetId) { r.status = 'UNCHANGED'; r.issues.push('This slot already holds this exact image.'); continue; }
      if (sameAssetElsewhere) { r.status = 'DUPLICATE_SLOT'; r.issues.push(`This image is already in slot ${sameAssetElsewhere.slot} of the product; one image cannot fill two slots.`); continue; }
      const isDupBytes = Object.values(hashByAsset).includes(r.sha256);
      if (existing) { r.status = isDupBytes ? 'EXACT_DUPLICATE' : 'WOULD_REPLACE'; replaces.push(r.slot!); }
      else r.status = isDupBytes ? 'EXACT_DUPLICATE' : 'NEW';
      proposals.push({ slot: r.slot!, assetId: r.assetId!, altText: r.altText });
    }
    if (proposals.length === 0) continue;
    const proposedMap = [...currentMap.filter((a) => !proposals.some((p) => p.slot === a.slot)), ...proposals].sort((a, b) => a.slot - b.slot);
    products.push({ productId, sku: ctx?.sku ?? group[0].productSku ?? '', expectedRevision: ctx?.mediaRevision ?? 0, currentMap, proposedMap, replaces });
  }

  const totals = Object.create(null) as Record<ImportRowStatus | 'TOTAL', number>;
  for (const s of ['NEW', 'UNCHANGED', 'EXACT_DUPLICATE', 'WOULD_REPLACE', 'UNMATCHED_PRODUCT', 'AMBIGUOUS', 'DUPLICATE_SLOT', 'INVALID_SLOT', 'INVALID_FILE', 'MANIFEST_CONFLICT'] as ImportRowStatus[]) totals[s] = 0;
  for (const r of rows) totals[r.status] += 1;
  totals.TOTAL = rows.length;
  const blocking = rows.some((r) => BLOCKING_STATUSES.has(r.status));
  const planHash = createHash('sha256')
    .update(IMPORTER_VERSION)
    .update(JSON.stringify(rows.map((r) => [r.filename, r.sha256, r.productId, r.slot, r.status]).sort()))
    .update(JSON.stringify(products.map((p) => [p.productId, p.expectedRevision, p.proposedMap]).sort()))
    .digest('hex');
  return { importerVersion: IMPORTER_VERSION, rows, products, totals, blocking, planHash };
}
