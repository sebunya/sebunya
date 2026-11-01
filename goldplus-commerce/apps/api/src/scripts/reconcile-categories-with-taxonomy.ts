/**
 * The storefront browses by the TAXONOMY; the admin product form can only file
 * a product into the `categories` table. Those two lists had drifted: the
 * taxonomy publishes five categories, the table held three, so Storage/Car/PC
 * products could only be filed under "Other" and the shop had to guess their
 * category from the product name.
 *
 * This adds the categories the taxonomy already defines and the table is
 * missing. It invents nothing — the taxonomy is the owner's own configuration —
 * touches no product, and is idempotent: run it again and it does nothing.
 *
 *   npx tsx src/scripts/reconcile-categories-with-taxonomy.ts [--apply]
 *
 * Without --apply it only reports what it would add.
 */
import { db } from '../infrastructure/db/client';
import { categories } from '../infrastructure/db/schema/products';
import { Registry } from '../infrastructure/Registry';

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const taxonomy = await Registry.getInstance().taxonomyService.getPublicConfig();
  const existing = await db.select({ name: categories.name, slug: categories.slug }).from(categories);
  const haveSlug = new Set(existing.map((c) => c.slug));
  const haveName = new Set(existing.map((c) => c.name));

  const missing = taxonomy
    .map((category) => ({ name: category.name, slug: category.slug || slugify(category.name) }))
    .filter((c) => !haveSlug.has(c.slug) && !haveName.has(c.name));

  console.log(`taxonomy: ${taxonomy.map((c) => c.name).join(', ')}`);
  console.log(`categories table: ${existing.map((c) => c.name).join(', ')}`);
  if (missing.length === 0) {
    console.log('nothing to add — the two lists already agree.');
    process.exit(0);
  }
  console.log(`missing: ${missing.map((c) => `${c.name} (${c.slug})`).join(', ')}`);
  if (!apply) {
    console.log('dry run — pass --apply to add them.');
    process.exit(0);
  }
  for (const c of missing) {
    await db.insert(categories).values({ name: c.name, slug: c.slug }).onConflictDoNothing();
    console.log(`added ${c.name}`);
  }
  const after = await db.select({ name: categories.name }).from(categories);
  console.log('categories now:', after.map((r) => r.name).sort().join(', '));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
