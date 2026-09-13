#!/usr/bin/env node
// Static storefront image optimiser and budget guard.
//
//   node scripts/images/optimise-static-images.mjs           generate missing/stale variants, write the manifest, then check
//   node scripts/images/optimise-static-images.mjs --check   check only (no sharp needed): budgets + every generated variant present
//   node scripts/images/optimise-static-images.mjs --force   regenerate every variant
//
// Driven by apps/web/static-images.config.json. Generation uses the sharp that
// the API already depends on (apps/api), so the web app gains no native
// dependency. Checking reads image headers directly and runs anywhere.
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { imageDimensions } from './image-dimensions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = join(ROOT, 'apps/web/static-images.config.json');
const RASTER = /\.(png|jpe?g|webp|gif)$/i;

export function loadConfig(path = CONFIG_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const outputFor = (entry, w) => entry.output.replace('{w}', String(w));
const entryHash = (entry, sourceBytes) => createHash('sha256').update(JSON.stringify({ widths: entry.widths, webp: entry.webp, output: entry.output })).update(sourceBytes).digest('hex').slice(0, 16);

function walk(dir, skip) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!skip.has(name)) out.push(...walk(p, skip)); }
    else if (RASTER.test(name)) out.push(p);
  }
  return out;
}

/** Every problem found, as human-readable strings. Empty means the tree is within budget. */
export function checkStaticImages(config = loadConfig(), root = ROOT) {
  const problems = [];
  const pub = join(root, config.publicDir);
  const manifestPath = join(root, config.manifest);
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

  // 1. Generated variants exist and match the manifest's recorded source hash.
  for (const entry of config.generate ?? []) {
    const src = join(pub, entry.source);
    if (!existsSync(src)) { problems.push(`${entry.id}: source ${entry.source} is missing`); continue; }
    const expected = entryHash(entry, readFileSync(src));
    if (manifest[entry.id]?.hash !== expected) problems.push(`${entry.id}: variants are stale or were never generated (run pnpm images:optimise)`);
    for (const w of entry.widths) {
      const out = join(pub, outputFor(entry, w));
      if (!existsSync(out)) { problems.push(`${entry.id}: missing ${outputFor(entry, w)}`); continue; }
      const d = imageDimensions(out);
      if (!d) problems.push(`${entry.id}: ${outputFor(entry, w)} is not a readable image`);
      else if (d.width !== w) problems.push(`${entry.id}: ${outputFor(entry, w)} is ${d.width}px wide, expected ${w}`);
    }
  }

  // 2. Budgets. The most specific directory rule wins; uploads are out of scope.
  const rules = [...(config.budgets ?? [])].sort((a, b) => b.dir.length - a.dir.length);
  // A source the optimiser generates variants from is a master, not what pages load.
  const sources = new Set((config.generate ?? []).map((e) => e.source));
  const variantSets = new Map();
  for (const file of walk(pub, new Set(['uploads']))) {
    const rel = relative(pub, file).split('\\').join('/');
    if (config.allow?.[rel] || sources.has(rel)) continue;
    // '.' is the catch-all for anything not under a more specific directory rule
    const rule = rules.find((r) => r.dir === '.' || rel.startsWith(`${r.dir}/`));
    if (!rule) continue;
    const bytes = statSync(file).size;
    const d = imageDimensions(file);
    if (!d) { problems.push(`${rel}: unreadable image header`); continue; }
    if (rule.requireVariantsFrom) {
      if (!variantSets.has(rule.requireVariantsFrom)) {
        const p = join(root, rule.requireVariantsFrom);
        const m = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
        const variantFiles = new Set(Object.values(m).flatMap((e) => (e.variants ?? []).map((v) => v.url.replace(/^\//, ''))));
        variantSets.set(rule.requireVariantsFrom, { masters: m, variantFiles });
      }
      // A variant is judged by the budget. A master may exceed it only when the
      // storefront serves it through more than one smaller variant.
      const { masters, variantFiles } = variantSets.get(rule.requireVariantsFrom);
      if (!variantFiles.has(rel) && (masters[`/${rel}`]?.variants?.length ?? 0) > 1) continue;
    }
    if (d.width > rule.maxWidth) problems.push(`${rel}: ${d.width}px wide exceeds the ${rule.dir} budget of ${rule.maxWidth}px`);
    if (bytes > rule.maxBytes) problems.push(`${rel}: ${bytes} bytes exceeds the ${rule.dir} budget of ${rule.maxBytes}`);
  }
  return problems;
}

async function generate(config, force) {
  const apiRequire = createRequire(join(ROOT, 'apps/api/package.json'));
  let sharp;
  try { sharp = apiRequire('sharp'); } catch { throw new Error('sharp is not installed (pnpm install in apps/api)'); }
  const pub = join(ROOT, config.publicDir);
  const manifestPath = join(ROOT, config.manifest);
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  for (const entry of config.generate ?? []) {
    const src = join(pub, entry.source);
    const input = readFileSync(src);
    const hash = entryHash(entry, input);
    const meta = await sharp(input).metadata();
    const current = manifest[entry.id]?.hash === hash && entry.widths.every((w) => existsSync(join(pub, outputFor(entry, w))));
    if (current && !force) { console.log(`= ${entry.id} up to date`); continue; }
    const variants = [];
    for (const w of entry.widths) {
      if (w > meta.width) throw new Error(`${entry.id}: ${w}px is wider than the ${meta.width}px source; upscaling is refused`);
      const out = join(pub, outputFor(entry, w));
      mkdirSync(dirname(out), { recursive: true });
      const pipeline = sharp(input).resize({ width: w, withoutEnlargement: true });
      const buf = await pipeline.webp(entry.webp ?? { quality: 82, effort: 6 }).toBuffer();
      writeFileSync(out, buf);
      const d = imageDimensions(out);
      variants.push({ w, url: `/${outputFor(entry, w)}`, width: d.width, height: d.height, bytes: buf.length });
      console.log(`+ ${outputFor(entry, w)}  ${d.width}x${d.height}  ${buf.length} B`);
    }
    manifest[entry.id] = { source: `/${entry.source}`, sourceBytes: input.length, width: meta.width, height: meta.height, hash, variants };
  }
  const ordered = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
  writeFileSync(manifestPath, JSON.stringify(ordered, null, 2) + '\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const config = loadConfig();
  try {
    if (!args.has('--check')) await generate(config, args.has('--force'));
    const problems = checkStaticImages(config);
    if (problems.length) { console.error(`static images: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`); process.exit(1); }
    console.log('static images: within budget, all generated variants present');
  } catch (e) {
    console.error(`static images: ${e.message}`);
    process.exit(1);
  }
}
