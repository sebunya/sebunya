import '../config/env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Writes category descriptions into the stored taxonomy through the SAME
 * service the /admin/categories editor saves with (TaxonomyService.updateConfig,
 * sanitised, versioned), audited like the editor's own save. A category page
 * is served noindex and left out of the categories sitemap until it has a
 * description, so until this runs the categories sitemap is an empty urlset.
 * Idempotent: re-running writes the same text. Categories not named in the
 * data file are left exactly as stored, descriptions included.
 *
 *   ACTOR_USER_ID=<uuid> DRY_RUN=1 npx tsx src/scripts/apply-category-descriptions.ts
 */
interface DataFile { categories: Record<string, string> }

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const dryRun = process.env.DRY_RUN === '1';
  const dataFile = String(process.env.DATA_FILE ?? '').trim() || join(__dirname, 'data', 'category-descriptions-2026-10-12.json');
  const data = JSON.parse(readFileSync(dataFile, 'utf8')) as DataFile;
  for (const [slug, text] of Object.entries(data.categories)) {
    if (text.trim().length > 300) throw new Error(`${slug}: description is ${text.trim().length} characters; the taxonomy keeps 300.`);
  }

  const r = Registry.getInstance();
  const { config, version } = await r.taxonomyService.getAdminConfig();
  const bySlug = new Map(config.map((c) => [c.slug, c] as const));
  let changed = 0;
  for (const [slug, text] of Object.entries(data.categories)) {
    const cat = bySlug.get(slug);
    if (!cat) { console.log(`  MISSING ${slug} — not a stored category`); continue; }
    const same = (cat.description ?? '') === text.trim();
    console.log(`  ${slug}: ${same ? 'unchanged' : `"${(cat.description ?? '').slice(0, 40) || '(none)'}" → "${text.trim().slice(0, 60)}…"`}`);
    if (!same) { cat.description = text.trim(); changed += 1; }
  }
  if (dryRun || changed === 0) {
    console.log(`taxonomy v${version}: ${changed} description(s) to write${dryRun ? ' (DRY RUN — nothing written)' : ''}`);
    return;
  }
  const result = await r.taxonomyService.updateConfig(config, actorId);
  await r.createAuditLogUseCase.execute({
    actorId,
    action: 'TAXONOMY_UPDATED',
    entity: 'taxonomy_config',
    entityId: 'global',
    previousState: { version },
    newState: { version: result.version, categoriesCreated: [], descriptionsWritten: changed, source: dataFile.split('/').pop() },
  });
  console.log(`taxonomy v${version} → v${result.version}: ${changed} description(s) written`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
