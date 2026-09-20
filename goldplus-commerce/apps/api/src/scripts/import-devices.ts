import '../config/env';
import { readFileSync } from 'node:fs';
import { DrizzleDeviceRepository } from '../infrastructure/db/repositories/DrizzleDeviceRepository';
import { deviceSlug } from '../domain/products/Devices';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Device list import. Usage: tsx import-devices.ts <file.csv> [--apply]
 *
 * Header: brand,model,modelAliases (aliases separated by |). DRY RUN unless
 * --apply. Rerun-safe: a device whose slug already exists is skipped, never
 * duplicated or overwritten. Devices carry no fit claim — compatibility is a
 * separate, evidenced import (import-device-compatibility.ts).
 */
async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error('Usage: import-devices.ts <file.csv> [--apply]');
  const apply = flag === '--apply';
  const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  const header = lines[0].split(',').map((h) => h.trim());
  const at = (name: string) => header.indexOf(name);
  if (at('brand') < 0 || at('model') < 0) throw new Error('Header must include brand,model');
  const repo = new DrizzleDeviceRepository();
  const existing = new Set((await repo.adminList(10000)).map((d) => d.slug));
  let created = 0; let skipped = 0; const invalid: string[] = [];
  for (const [i, line] of lines.slice(1).entries()) {
    const cells = line.split(',').map((c) => c.trim());
    const brand = cells[at('brand')] ?? ''; const model = cells[at('model')] ?? '';
    if (!brand || !model) { invalid.push(`row ${i + 2}: brand and model are required`); continue; }
    const slug = deviceSlug(brand, model);
    if (existing.has(slug)) { skipped += 1; continue; }
    existing.add(slug);
    const modelAliases = at('modelAliases') >= 0 ? (cells[at('modelAliases')] ?? '').split('|').map((a) => a.trim()).filter(Boolean) : [];
    if (apply) await repo.createDevice({ brand, model, modelAliases });
    created += 1;
  }
  process.stdout.write(`${apply ? 'APPLIED' : 'DRY RUN'}: ${created} to create, ${skipped} already present, ${invalid.length} invalid\n${invalid.join('\n')}${invalid.length ? '\n' : ''}`);
  if (invalid.length) process.exitCode = 1;
}

main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; }).finally(() => endDbConnection());
