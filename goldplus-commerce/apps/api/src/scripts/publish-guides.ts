import '../config/env';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { parseGuideFile, internalLinks } from '../domain/blog/GuideFile';
import { slugifyTitle, canPublish } from '../domain/blog/BlogPost';

/**
 * Publishes the guide drafts under docs/content/guides through the SAME use
 * cases the admin blog editor uses (create as DRAFT, update, publish), audited
 * per article like the editor's own writes. Idempotent: a guide whose slug
 * already exists is updated in place (a PUBLISHED one keeps its URL and must
 * still pass the publish gate); a guide marked `Publish: hold` is saved as a
 * DRAFT and left for an operator to publish by hand.
 *
 *   ACTOR_USER_ID=<uuid> DRY_RUN=1 GUIDES_DIR=/guides npx tsx src/scripts/publish-guides.ts
 *   (the builder image carries no docs/: bind-mount docs/content/guides from the host checkout at /guides)
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const dryRun = process.env.DRY_RUN === '1';
  const dir = resolve(String(process.env.GUIDES_DIR ?? '').trim() || join(__dirname, '..', '..', '..', '..', 'docs', 'content', 'guides'));
  const files = readdirSync(dir).filter((f) => /^\d+-.*\.md$/.test(f)).sort();
  if (files.length === 0) throw new Error(`No numbered guide files in ${dir}.`);

  const r = Registry.getInstance();
  let created = 0, updated = 0, published = 0, held = 0, failed = 0;
  for (const file of files) {
    const parsed = parseGuideFile(readFileSync(join(dir, file), 'utf8'));
    if (!parsed.ok) { failed += 1; console.log(`  ${file}: INVALID — ${parsed.message}`); continue; }
    const g = parsed.value;
    const slug = slugifyTitle(g.title);

    const relatedProductIds: string[] = [];
    for (const sku of g.relatedSkus) {
      const row = rowsOf(await db.execute(sql`select id from products where upper(sku) = ${sku} and active = true and approval_status = 'approved'`))[0];
      if (row) relatedProductIds.push(String(row.id));
      else console.log(`    related sku ${sku}: not an active product, skipped`);
    }

    const existing = await r.blogRepo.findBySlug(slug, { includeUnpublished: true });
    const gate = canPublish({ title: g.title, excerpt: g.excerpt, body: g.body });
    const intent = g.hold ? 'hold as DRAFT' : gate.ok ? 'publish' : `cannot publish (${gate.ok ? '' : gate.message})`;
    console.log(`  ${file}: ${existing ? `update ${existing.status} /blog/${existing.slug}` : `create /blog/${slug}`} → ${intent}; links: ${internalLinks(g.body).join(' ') || 'none'}; related: ${relatedProductIds.length}`);
    if (dryRun) continue;

    const input = { title: g.title, slug, excerpt: g.excerpt, body: g.body, metaTitle: g.metaTitle, metaDescription: g.metaDescription, relatedProductIds };
    let post;
    if (existing) {
      const res = await r.updatePostUseCase.execute(existing.id, input);
      if (!res.ok) { failed += 1; console.log(`    FAILED: ${res.message}`); continue; }
      post = res.value; updated += 1;
      await r.createAuditLogUseCase.execute({ actorId, action: 'BLOG_POST_UPDATED', entity: 'blog_post', entityId: post.id, newState: { slug: post.slug, title: post.title, source: file } });
    } else {
      const res = await r.createPostUseCase.execute({ ...input, authorId: actorId, authorName: 'GoldPlus' });
      if (!res.ok) { failed += 1; console.log(`    FAILED: ${res.message}`); continue; }
      post = res.value; created += 1;
      await r.createAuditLogUseCase.execute({ actorId, action: 'BLOG_POST_CREATED', entity: 'blog_post', entityId: post.id, newState: { slug: post.slug, title: post.title, source: file } });
    }

    if (g.hold) { held += 1; continue; }
    if (post.status === 'PUBLISHED') continue;
    const pub = await r.publishPostUseCase.execute(post.id);
    if (!pub.ok) { failed += 1; console.log(`    PUBLISH REFUSED: ${pub.message}`); continue; }
    published += 1;
    await r.createAuditLogUseCase.execute({ actorId, action: 'BLOG_POST_PUBLISHED', entity: 'blog_post', entityId: post.id, newState: { slug: post.slug, publishedAt: pub.value.publishedAt, source: file } });
  }
  console.log(`${files.length} guides: created ${created}, updated ${updated}, published ${published}, held ${held}, failed ${failed}${dryRun ? ' (DRY RUN — nothing written)' : ''}`);
  if (failed > 0) process.exitCode = 1;
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
