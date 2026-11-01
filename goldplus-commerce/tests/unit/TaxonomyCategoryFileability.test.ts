import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The site keeps two lists of categories: the TAXONOMY the storefront browses
 * by, and the `categories` rows a product can be FILED into. They had drifted —
 * five against three — and the whole class of bugs that followed (products
 * invisible, the header dropdown unable to find them, a keyword guesser papering
 * over the difference) came from that one gap. Saving the taxonomy now closes
 * it, so they cannot drift apart again.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('a category the shop browses by can always be filed into', () => {
  const route = read('apps/api/src/interfaces/http/routes/admin/taxonomy.ts');

  it('saving the taxonomy creates the missing category rows', () => {
    expect(route).toMatch(/registry\.productRepo\.ensureCategories\(/);
    expect(route).toMatch(/config\.map\(\(category\) => \(\{ name: category\.name, slug: category\.slug \}\)\)/);
  });

  it('it reconciles against the SAVED taxonomy, not the unvalidated request body', () => {
    // updateConfig sanitises and may drop entries; using body.config could
    // create a row for a category the taxonomy rejected.
    const block = route.slice(route.indexOf('ensureCategories') - 400, route.indexOf('ensureCategories'));
    expect(block).toMatch(/getAdminConfig\(\)/);
    expect(route).not.toMatch(/ensureCategories\(\s*body\.config/);
  });

  it('a filing row that cannot be created never fails the operator’s save', () => {
    const block = route.slice(route.indexOf('let categoriesCreated'), route.indexOf('createAuditLogUseCase'));
    expect(block).toMatch(/try \{/);
    expect(block).toMatch(/\} catch \{/);
  });

  it('what was created is audited and returned, not silently done', () => {
    expect(route).toMatch(/newState: \{ version: result\.version, categoriesCreated \}/);
    expect(route).toMatch(/data: \{ version: result\.version, categoriesCreated \}/);
  });

  it('the repository only ever adds — it never renames or deletes a category', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts');
    const block = repo.slice(repo.indexOf('async ensureCategories'), repo.indexOf('async checkCategoryExists'));
    expect(block).toMatch(/onConflictDoNothing\(\)/);
    expect(block).toMatch(/if \(haveSlug\.has\(category\.slug\) \|\| haveName\.has\(category\.name\)\) continue;/);
    expect(block).not.toMatch(/\.delete\(|db\.update\(/);
    // Skips junk rather than inserting a nameless category.
    expect(block).toMatch(/if \(!category\.name \|\| !category\.slug\) continue;/);
  });
});
