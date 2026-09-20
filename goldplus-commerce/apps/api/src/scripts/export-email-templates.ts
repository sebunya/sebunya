/**
 * Exports the email package for the provider's review.
 *
 * It is a COPY of apps/api/templates/email — the same files the application
 * renders from — plus sample renders with no template syntax left in them. A
 * review pack that has drifted from the code is worse than none, so nothing
 * here is written by hand.
 *
 *   npx tsx apps/api/src/scripts/export-email-templates.ts [outDir]
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GENERATED_EMAIL_TEMPLATES } from '../infrastructure/notifications/email/generatedEmailTemplates';
import { renderTemplate } from '../infrastructure/notifications/email/renderEmailTemplate';

const SRC = join(__dirname, '../../templates/email');
const outDir = process.argv[2] || 'email-templates';
mkdirSync(join(outDir, 'review'), { recursive: true });

// The editable originals, exactly as the application uses them.
for (const dir of ['templates', 'plain-text', 'sample-data']) {
  cpSync(join(SRC, dir), join(outDir, dir), { recursive: true });
}
cpSync(join(SRC, 'subjects.csv'), join(outDir, 'subjects.csv'));
cpSync(join(SRC, 'README.md'), join(outDir, 'START-HERE.md'));

// Sample renders: what a recipient actually sees, with sample data only.
const samples = readdirSync(join(SRC, 'sample-data')).filter((f) => f.endsWith('.json'));
const index: string[] = [];
for (const file of samples) {
  const data = JSON.parse(readFileSync(join(SRC, 'sample-data', file), 'utf8'));
  const key = Object.values(GENERATED_EMAIL_TEMPLATES).find((t) => file.includes(t.key))?.key;
  if (!key) continue;
  const t = GENERATED_EMAIL_TEMPLATES[key];
  const html = renderTemplate(t.html, data);
  if (html.includes('{{')) throw new Error(`${key} still has template syntax after rendering`);
  const name = `${t.audience === 'internal' ? 'internal' : 'customer'}-${key}.html`;
  writeFileSync(join(outDir, 'review', name), html, 'utf8');
  index.push(`<li><a href="review/${name}">${renderTemplate(t.subject, data, { escape: false })}</a> — ${t.audience}</li>`);
}

writeFileSync(join(outDir, 'OPEN-ME.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>GoldPlus transactional emails</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.6}li{margin:.4rem 0}</style>
</head><body>
<h1>GoldPlus transactional emails</h1>
<p>Every message below is sent in reply to something the recipient did — an order, a payment,
a password reset, an enquiry. There is no marketing mail, no mailing list and no bought contacts.
Sender: noreply@shopgoldplus.com, replies to support@shopgoldplus.com.</p>
<p>Sample data only: no real customer's name, phone, address or order appears.</p>
<ul>${index.join('')}</ul>
</body></html>`, 'utf8');

console.log(`${index.length} templates exported to ${outDir}`);
