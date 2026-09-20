/**
 * Compiles the email templates into a TypeScript module.
 *
 * The templates live as .html and .txt under apps/api/templates/email so they
 * stay readable, reviewable and exportable for the provider. The API build only
 * compiles TypeScript — nothing copies loose files into dist — so a template
 * left as .html would simply not exist in production. Committing the generated
 * module keeps the runtime honest with no build-step surprises.
 *
 *   npx tsx apps/api/src/scripts/build-email-templates.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../templates/email');
const OUT = join(__dirname, '../infrastructure/notifications/email/generatedEmailTemplates.ts');

const read = (dir: string, ext: string) =>
  Object.fromEntries(
    readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith(ext))
      .map((f) => [f.replace(ext, ''), readFileSync(join(ROOT, dir, f), 'utf8')]),
  );

const html = read('templates', '.html');
const text = read('plain-text', '.txt');

/** event,file,subject,preheader,audience — quoted fields may contain commas. */
function parseSubjects(csv: string) {
  const out: Record<string, { subject: string; preheader: string; audience: string; file: string }> = {};
  const rows = csv.trim().split('\n').slice(1);
  for (const row of rows) {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (const ch of row) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const [event, file, subject, preheader, audience] = cells;
    if (event) out[event] = { file, subject, preheader, audience };
  }
  return out;
}
const subjects = parseSubjects(readFileSync(join(ROOT, 'subjects.csv'), 'utf8'));

const banner = `/**
 * GENERATED — do not edit by hand.
 *
 * Source: apps/api/templates/email (the package reviewed for the provider).
 * Rebuild: npx tsx apps/api/src/scripts/build-email-templates.ts
 *
 * What the shop sends and what was submitted for review are the same bytes,
 * because both come from these files.
 */`;

const body = `${banner}

export interface EmailTemplateDefinition {
  key: string;
  subject: string;
  preheader: string;
  audience: 'customer' | 'internal';
  html: string;
  text: string;
}

export const GENERATED_EMAIL_TEMPLATES: Record<string, EmailTemplateDefinition> = {
${Object.entries(subjects).map(([event, meta]) => {
  const base = meta.file.replace('templates/', '').replace('.html', '');
  const h = html[base];
  const t = text[base] ?? '';
  if (!h) throw new Error(`No HTML for ${event} (${base})`);
  return `  ${JSON.stringify(event)}: {
    key: ${JSON.stringify(event)},
    subject: ${JSON.stringify(meta.subject)},
    preheader: ${JSON.stringify(meta.preheader)},
    audience: ${JSON.stringify(meta.audience)} as 'customer' | 'internal',
    html: ${JSON.stringify(h)},
    text: ${JSON.stringify(t)},
  },`;
}).join('\n')}
};

export const GENERATED_EMAIL_TEMPLATE_KEYS = Object.keys(GENERATED_EMAIL_TEMPLATES);
`;

writeFileSync(OUT, body, 'utf8');
console.log(`${Object.keys(subjects).length} templates compiled into ${OUT}`);
