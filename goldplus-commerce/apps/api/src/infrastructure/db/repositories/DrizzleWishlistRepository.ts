import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IWishlistRepository } from '../../../application/ports/IWishlistRepository';

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;

/**
 * Plain SQL over the wishlists table that migration 0003 created (user_id, product_id, added_at; primary key on
 * the pair; both foreign keys cascade). No schema object is declared for it, so nothing here can drift the
 * migration snapshot.
 */
export class DrizzleWishlistRepository implements IWishlistRepository {
  async list(userId: string, limit: number): Promise<string[]> {
    const r = await db.execute(sql`select product_id from wishlists where user_id = ${userId} order by added_at desc limit ${Math.max(1, Math.min(limit, 200))}`);
    return rowsOf(r).map((x) => String(x.product_id));
  }

  async add(userId: string, productId: string): Promise<'added' | 'unknown_product'> {
    // Only an approved, active product can be saved; the insert says nothing about anything else.
    const r = await db.execute(sql`
      insert into wishlists (user_id, product_id)
      select ${userId}, p.id from products p where p.id = ${productId} and p.approval_status = 'approved' and p.active = true
      on conflict (user_id, product_id) do update set added_at = now()
      returning product_id`);
    return rowsOf(r).length ? 'added' : 'unknown_product';
  }

  async remove(userId: string, productId: string): Promise<void> {
    await db.execute(sql`delete from wishlists where user_id = ${userId} and product_id = ${productId}`);
  }

  async has(userId: string, productId: string): Promise<boolean> {
    const r = await db.execute(sql`select 1 from wishlists where user_id = ${userId} and product_id = ${productId} limit 1`);
    return rowsOf(r).length > 0;
  }

  async count(userId: string): Promise<number> {
    const r = await db.execute(sql`select count(*)::int as n from wishlists where user_id = ${userId}`);
    return Number(rowsOf(r)[0]?.n ?? 0);
  }
}
