import '../config/env';
import { readFileSync } from 'node:fs';
import { DrizzleDeviceRepository } from '../infrastructure/db/repositories/DrizzleDeviceRepository';
import { RawCompatibilityRow } from '../domain/products/DeviceCompatibilityImport';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * U2 — device-compatibility bulk import CLI.
 *
 * Usage: tsx import-device-compatibility.ts <file.csv> <actorId>
 *
 * The CSV header must be: productRef,deviceRef,fitType,confidence,evidenceSource,notes
 * (productRef = sku or product id; deviceRef = device slug). The WHOLE file is
 * validated and every reference resolved before a single canonical row commits;
 * per-row errors are printed and nothing is applied. No specification is invented
 * — confidence is whatever the file declares, and 'verified' requires an evidence
 * source. See docs/platform/.../U2_DEVICE_SEED_MANIFEST.md for the source format.
 */

function parseCsv(text: string): RawCompatibilityRow[] {
  // Minimal RFC-4180-ish parser: no embedded newlines inside quotes (the import
  // validator bounds cell content). Good enough for an operational import file.
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitRow(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const get = (name: string) => (idx(name) >= 0 ? (cells[idx(name)] ?? '') : '');
    return {
      productRef: get('productRef'),
      deviceRef: get('deviceRef'),
      fitType: get('fitType'),
      confidence: get('confidence'),
      evidenceSource: get('evidenceSource'),
      notes: get('notes'),
    };
  });
}

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  const [file, actorId] = process.argv.slice(2);
  if (!file || !actorId) {
    console.error('Usage: tsx import-device-compatibility.ts <file.csv> <actorId>');
    process.exit(2);
  }
  const buf = readFileSync(file);
  const rows = parseCsv(buf.toString('utf8'));
  const repo = new DrizzleDeviceRepository();
  const result = await repo.importCompatibility(rows, { actorId, fileByteLength: buf.byteLength });
  if (result.errors.length) {
    console.error(`Import REJECTED — ${result.errors.length} error(s); nothing committed:`);
    for (const e of result.errors) console.error(`  row ${e.row} [${e.column}]: ${e.message}`);
    await endDbConnection();
    process.exit(1);
  }
  console.log(`Import OK — ${result.committed} compatibility row(s) committed.`);
  await endDbConnection();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Import failed:', err instanceof Error ? err.message : err);
  await endDbConnection().catch(() => {});
  process.exit(1);
});
