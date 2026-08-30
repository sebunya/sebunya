/**
 * Products sitting in "Other" are already DISPLAYED under a real category — the
 * storefront infers one from the product name because the categories table used
 * to be missing them. The database never learned that, so the header's
 * predictive search (which queries the database, not the storefront's inference)
 * could not find them by category.
 *
 * This files such a product into the category the site already shows it under,
 * using the SAME keyword rules as the storefront. It changes no name, price,
 * stock or approval state, only which category the row points at, and it only
 * ever moves a product OUT of "Other" — never between real categories.
 *
 *   npx tsx src/scripts/file-uncategorised-products.ts [--apply]
 *
 * Dry run unless --apply is given.
 */
import { db } from '../infrastructure/db/client';
import { products, categories } from '../infrastructure/db/schema/products';
import { eq } from 'drizzle-orm';

/** The storefront's own rules, in the storefront's own order (PC, Car, Storage). */
function displayedCategoryFor(name: string): string | null {
  if (/\b(mouse|mice|sound card|audio card)\b/i.test(name)) return 'PC Accessories';
  if (/\b(car|mount|vehicle)\b/i.test(name)) return 'Car Accessories';
  if (/\b(flash|drive|usb|sd|storage|microsd)\b/i.test(name)) return 'Storage Devices';
  return null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const cats = await db.select({ id: categories.id, name: categories.name }).from(categories);
  const byName = new Map(cats.map((c) => [c.name, c.id]));
  const otherId = byName.get('Other');

  const rows = await db
    .select({ id: products.id, name: products.name, categoryId: products.categoryId, categoryName: products.categoryName })
    .from(products);

  const moves = rows
    .filter((r) => r.categoryId === otherId || r.categoryName === 'Other' || !r.categoryName)
    .map((r) => ({ row: r, target: displayedCategoryFor(r.name) }))
    .filter((m): m is { row: typeof rows[number]; target: string } => m.target !== null && byName.has(m.target));

  if (moves.length === 0) {
    console.log('nothing to file — no product in "Other" that the storefront already shows elsewhere.');
    process.exit(0);
  }
  for (const m of moves) console.log(`${m.row.name}: Other -> ${m.target}`);
  if (!apply) {
    console.log(`dry run — ${moves.length} product(s); pass --apply to file them.`);
    process.exit(0);
  }
  for (const m of moves) {
    await db
      .update(products)
      .set({ categoryId: byName.get(m.target) as string, categoryName: m.target })
      .where(eq(products.id, m.row.id));
    console.log(`filed ${m.row.name}`);
  }
  console.log('done.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
