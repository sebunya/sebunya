import { sql } from 'drizzle-orm';
import { db } from '../client';
import { ILifecycleReadRepository, CustomerOrderStats } from '../../../application/ports/ILifecycleReadRepository';
import { ConsentState } from '../../../domain/identity/CustomerLifecycle';

export class DrizzleLifecycleReadRepository implements ILifecycleReadRepository {
  async listCustomerOrderStats(limit = 500): Promise<CustomerOrderStats[]> {
    const bounded = Math.max(1, Math.min(limit, 2000));
    const result: any = await db.execute(sql`
      select user_id as "userId",
             count(*)::int as "ordersCount",
             min(created_at) as "firstOrderAt",
             max(created_at) as "lastOrderAt"
      from orders
      where user_id is not null
      group by user_id
      order by max(created_at) desc
      limit ${bounded}
    `);
    const rows: any[] = Array.isArray(result) ? result : result.rows ?? [];
    return rows.map((r) => ({
      userId: String(r.userId),
      ordersCount: Number(r.ordersCount),
      firstOrderAt: r.firstOrderAt ? new Date(r.firstOrderAt) : null,
      lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt) : null,
    }));
  }

  async getPersonalisationConsent(userIds: string[]): Promise<Map<string, ConsentState>> {
    const map = new Map<string, ConsentState>();
    // Owner decision (2026-08-07): first-party personalisation is on by default,
    // so absence is 'granted', not 'unknown'. An explicit stored withdrawal below
    // still overrides to 'denied'.
    for (const id of userIds) map.set(id, 'granted');
    if (userIds.length === 0) return map;
    // Identity refs are written by the consent module; we accept both raw ids
    // and 'user:<id>' refs. Any state other than an unexpired grant stays as
    // written; absence stays 'unknown' (which downstream treats as no consent).
    const refs = userIds.flatMap((id) => [id, `user:${id}`]);
    // Parameterised, not hand-escaped: the previous form built the IN list with
    // manual quote-doubling inside sql.raw — the exact identifier-escaping
    // pattern the drizzle advisory warns about, and needless when the driver can
    // bind the values.
    const result: any = await db.execute(sql`
      select customer_identity_ref as ref, state
      from customer_consent_states
      where purpose_key = 'personalization'
        and customer_identity_ref in (${sql.join(refs.map((r) => sql`${r}`), sql`, `)})
        and (expires_at is null or expires_at > now())
        and superseded_by is null
    `);
    const rows: any[] = Array.isArray(result) ? result : result.rows ?? [];
    for (const row of rows) {
      const userId = String(row.ref).startsWith('user:') ? String(row.ref).slice(5) : String(row.ref);
      const state: ConsentState = row.state === 'granted' ? 'granted' : row.state === 'withdrawn' || row.state === 'blocked_by_policy' ? 'denied' : 'unknown';
      // A denial anywhere outweighs a grant elsewhere for the same user.
      const existing = map.get(userId);
      if (existing === 'denied') continue;
      map.set(userId, state === 'denied' ? 'denied' : existing === 'granted' ? 'granted' : state);
    }
    return map;
  }
}
