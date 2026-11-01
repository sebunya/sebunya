import { normaliseBatteryCode } from '../../../apps/api/src/domain/batteries/BatteryCodes';

/**
 * Self-owned fixtures for real-PostgreSQL suites.
 *
 * Several suites used to borrow "the first user / product / category /
 * battery" in the database (`select id from users limit 1`). That made them
 * pass only on a production clone, crash on the clean snapshot database
 * (`scripts/integration-env.sh`), and quietly depend on whatever row happened
 * to sort first. Each suite now creates exactly what it uses and removes it
 * afterwards, so the same suite runs on either database.
 *
 * Usage:
 *   const fx = new Fixtures(raw);
 *   const actor = await fx.user();
 *   ...
 *   afterAll(() => fx.cleanup());   // before raw.end()
 */

type Sql = any;

const tag = () => `itest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export class Fixtures {
  private readonly users: string[] = [];
  private readonly categories: string[] = [];
  private readonly products: string[] = [];
  private readonly batteries: string[] = [];

  constructor(private readonly raw: Sql) {}

  async user(): Promise<string> {
    const [u] = await this.raw`insert into users (email, password_hash) values (${`${tag()}@example.test`}, 'x') returning id`;
    this.users.push(u.id);
    return u.id;
  }

  async category(): Promise<string> {
    const s = tag();
    const [c] = await this.raw`insert into categories (name, slug) values (${s}, ${s}) returning id`;
    this.categories.push(c.id);
    return c.id;
  }

  /** An active, approved, in-stock product in a category of its own (or the one given). */
  async product(opts: { categoryId?: string; price?: number } = {}): Promise<{ id: string; categoryId: string; sku: string }> {
    const categoryId = opts.categoryId ?? (await this.category());
    const s = tag().slice(0, 40);
    const [p] = await this.raw`
      insert into products (sku, model_number, name, slug, category_id, active, approval_status, stock_status, price_ugx)
      values (${s}, ${s}, ${`Fixture ${s}`}, ${s}, ${categoryId}, true, 'approved', 'in_stock', ${opts.price ?? 150_000})
      returning id`;
    this.products.push(p.id);
    return { id: p.id, categoryId, sku: s };
  }

  /** A battery profile on a fresh product. Lifecycle defaults to the column default (never ACTIVE). */
  async battery(): Promise<{ productId: string; canonicalCode: string }> {
    const { id: productId } = await this.product();
    const canonicalCode = `IT-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    await this.raw`
      insert into battery_profiles (product_id, canonical_code, canonical_code_normalised)
      values (${productId}, ${canonicalCode}, ${normaliseBatteryCode(canonicalCode)})`;
    this.batteries.push(productId);
    return { productId, canonicalCode };
  }

  /**
   * Removes everything this instance created, children first. Rows a suite
   * hangs off these fixtures (orders, claims, images) are the suite's to delete
   * before calling this; a leftover reference fails loudly here rather than
   * silently leaving data behind.
   */
  async cleanup(): Promise<void> {
    const { raw } = this;
    if (this.batteries.length) {
      await raw`delete from battery_aliases where battery_product_id = any(${this.batteries}::uuid[])`;
      await raw`delete from battery_profiles where product_id = any(${this.batteries}::uuid[])`;
    }
    if (this.products.length) {
      await raw`delete from product_prices where product_id = any(${this.products}::uuid[])`;
      await raw`delete from products where id = any(${this.products}::uuid[])`;
    }
    if (this.categories.length) await raw`delete from categories where id = any(${this.categories}::uuid[])`;
    if (this.users.length) await raw`delete from users where id = any(${this.users}::uuid[])`;
  }
}
