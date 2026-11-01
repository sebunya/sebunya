import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { INextBestActionAdvisor } from '../../application/ports/IAssistantConversationPorts';

type Decide = (input: { canonicalCustomerId: string; actorId: string; activationChannel?: string | null }) => Promise<{ ok: true; selectedAction: string } | { ok: false }>;
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;

/**
 * Goldie asks the Customer DNA engine what would help this customer most
 * (finish a checkout, use expiring points, a delivery follow-up, a welcome
 * back). The customer started the chat, so this is service, not marketing: no
 * activation channel is named. One decision per customer per six hours (each
 * decision is recorded and audited by the engine), cached in memory.
 */
export class NextBestActionAdvisor implements INextBestActionAdvisor {
  private cache = new Map<string, { at: number; action: string | null }>();
  constructor(private readonly decide: Decide, private readonly ttlMs = 6 * 3600_000) {}

  async forCustomer(userId: string): Promise<string | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.action;
    if (this.cache.size > 5000) this.cache.clear();
    const [p] = rowsOf(await db.execute(sql`select canonical_customer_id from customer_profiles where account_user_id = ${userId}::uuid and merged_into is null order by last_seen desc nulls last limit 1`));
    let action: string | null = null;
    if (p?.canonical_customer_id) {
      const r = await this.decide({ canonicalCustomerId: String(p.canonical_customer_id), actorId: 'system:goldie', activationChannel: null }).catch(() => ({ ok: false as const }));
      action = r.ok && r.selectedAction !== 'NO_ACTION' ? r.selectedAction : null;
    }
    this.cache.set(userId, { at: Date.now(), action });
    return action;
  }
}
