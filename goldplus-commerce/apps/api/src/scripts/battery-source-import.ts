import '../config/env';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { endDbConnection } from '../infrastructure/db/client';
import { Registry } from '../infrastructure/Registry';
import type { BatteryImportType } from '@goldplus/shared';

/**
 * Stage a real source workbook through the battery importer, exactly as the
 * admin screens do: upload, map, dry run. It stops there on purpose.
 *
 * It NEVER approves, applies or publishes anything. Approval needs a second
 * person and apply is theirs to press, because that is the control the brief
 * asks for. Use it to see, before anyone commits, what a file would do.
 *
 * Usage:
 *   tsx battery-source-import.ts <file.xlsx|csv> <IMPORT_TYPE> <actorId> [sheet]
 */

async function main() {
  const [file, importType, actorId, sheet] = process.argv.slice(2);
  if (!file || !importType || !actorId) {
    console.error('Usage: tsx battery-source-import.ts <file> <BATTERY_CATALOGUE|COMPATIBILITY|STOCK_RECEIPT|STOCK_COUNT|PRICE_UPDATE> <actorId> [sheet]');
    process.exit(2);
  }
  const uc = Registry.getInstance().batteryImportUseCases;
  const buffer = readFileSync(file);
  const filename = basename(file);

  const sheets = uc.listSheetNames(buffer, filename);
  console.log(`Sheets in ${filename}: ${sheets.join(' | ')}`);
  const chosen = sheet && sheets.includes(sheet) ? sheet : sheets[0];

  const { session, existed, suggestedMapping } = await uc.upload({
    importType: importType as BatteryImportType,
    name: `${filename} (${chosen})`,
    filename,
    mime: filename.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
    sheetName: chosen,
    actorId,
  });
  console.log(`\n${existed ? 'Already staged' : 'Staged'}: ${session.id} — ${session.totalRows} rows from "${chosen}"`);
  console.log(`Columns: ${session.sourceColumns.join(' | ')}`);
  console.log(`Suggested mapping: ${JSON.stringify(suggestedMapping, null, 2)}`);

  if (!Object.keys(suggestedMapping).length) {
    console.log('\nNo column could be mapped automatically. Map it at /admin/batteries/imports.');
    await endDbConnection();
    process.exit(0);
  }

  const mapped = await uc.saveMapping({ id: session.id, expectedVersion: session.version, mapping: suggestedMapping, actorId });
  const preview = await uc.preview({ id: session.id, expectedVersion: mapped.version, actorId });
  const s = preview.session;

  console.log(`\nDry run (nothing was written):`);
  console.log(`  ready to apply : ${s.validRows}`);
  console.log(`  held for review: ${s.heldRows}`);
  console.log(`  with errors    : ${s.invalidRows}`);

  const held = preview.rows.filter((r) => r.status === 'HELD');
  if (held.length) {
    console.log('\nHeld, each needing a person:');
    for (const r of held) console.log(`  row ${r.rowNumber} ${r.rowKey ?? ''}: ${String((r.normalizedData as Record<string, unknown> | null)?.hold ?? '')}`);
  }
  const invalid = preview.rows.filter((r) => r.status === 'INVALID');
  if (invalid.length) {
    console.log('\nWith errors:');
    for (const r of invalid.slice(0, 40)) console.log(`  row ${r.rowNumber}: ${r.validationErrors.join(' ')}`);
    if (invalid.length > 40) console.log(`  ... and ${invalid.length - 40} more (download the error report)`);
  }
  console.log(`\nNothing was approved or applied. Open /admin/batteries/imports/${session.id} to review it.`);
  await endDbConnection();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('\n', error instanceof Error ? error.message : error);
  await endDbConnection().catch(() => {});
  process.exit(1);
});
