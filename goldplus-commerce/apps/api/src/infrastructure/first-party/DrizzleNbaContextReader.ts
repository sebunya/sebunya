import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { ORDER_KEY_PREFIX } from '../../domain/customer-dna/IdentityStitching';
import { phoneSpellings } from '../../domain/advertising/ContactNormalisation';
import type { INbaContextReader, IWhatsAppMarketingGate } from '../../application/ports/first-party/FirstPartyPorts';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidList = (ids: string[]): SQL => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
const textList = (vals: string[]): SQL => sql.join(vals.map((v) => sql`${v}`), sql`, `);

/** Purposes that allow a marketing contact, per channel. */
const MARKETING_PURPOSES = ['marketing_offers_campaigns', 'whatsapp_marketing'];

/**
 * The real inputs of next-best-action (0157) for one customer: consent per
 * channel from the consent system (WhatsApp through its own gate, which also
 * checks the opted-in number is still the account's), open support tickets,
 * open fraud cases on their orders, what they bought in the last 30 days and
 * whether it is out of stock, and how many messages were SENT to them in the
 * last 7 days. A guest has no consent record, so no marketing channel.
 */
export class DrizzleNbaContextReader implements INbaContextReader {
  constructor(private readonly whatsapp: IWhatsAppMarketingGate) {}

  async read(input: { canonicalCustomerId: string; accountUserId: string | null }) {
    const account = input.accountUserId && UUID.test(input.accountUserId) ? input.accountUserId : null;
    const orderKeys = rows(await db.execute(sql`
      select identifier_key from customer_identity_links
      where canonical_customer_id = ${input.canonicalCustomerId}::uuid and status = 'ACTIVE' and signal_type = 'ORDER_CUSTOMER_RELATIONSHIP'`))
      .map((r) => String(r.identifier_key))
      .filter((k) => k.startsWith(ORDER_KEY_PREFIX))
      .map((k) => k.slice(ORDER_KEY_PREFIX.length))
      .filter((id) => UUID.test(id));
    const match: SQL[] = [];
    if (account) match.push(sql`user_id = ${account}::uuid`);
    if (orderKeys.length) match.push(sql`id in (${uuidList(orderKeys)})`);
    const orderIds = match.length
      ? rows(await db.execute(sql`select id from orders where ${sql.join(match, sql` or `)} limit 1000`)).map((r) => String(r.id))
      : [];

    const marketingChannels: Record<string, boolean> = {};
    let loyaltyBalance: number | null = null;
    let openSupportCases = 0;
    if (account) {
      const states = rows(await db.execute(sql`
        select channel_key, state from customer_consent_states
        where customer_identity_ref = ${account} and purpose_key in (${textList(MARKETING_PURPOSES)})
          and (expires_at is null or expires_at > now())`));
      for (const s of states) {
        const ch = String(s.channel_key);
        if (ch === 'whatsapp') continue; // decided by the WhatsApp gate below
        marketingChannels[ch] = marketingChannels[ch] === true || s.state === 'granted';
      }
      marketingChannels.whatsapp = await this.whatsapp.mayMarket(account).then((g) => g.allowed).catch(() => false);
      const [support] = rows(await db.execute(sql`
        select count(*)::int as n from support_issues where customer_id = ${account}::uuid and status in ('open', 'in-progress', 'in_progress')`));
      openSupportCases = Number(support?.n ?? 0);
      const [loyalty] = rows(await db.execute(sql`
        select coalesce(sum(e.points), 0)::int as balance from loyalty_accounts a
        left join loyalty_ledger_entries e on e.account_id = a.id where a.user_id = ${account}::uuid group by a.id`));
      loyaltyBalance = loyalty ? Number(loyalty.balance ?? 0) : null;
    }

    const [fraud] = orderIds.length ? rows(await db.execute(sql`
      select count(*)::int as n from fraud_cases where status in ('OPEN', 'IN_REVIEW') and source_ref in (${textList(orderIds)})`)) : [];
    const recent = orderIds.length ? rows(await db.execute(sql`
      select distinct oi.product_id, p.stock_status from order_items oi
      join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
      where o.id in (${uuidList(orderIds)}) and o.created_at > now() - interval '30 days' and o.status not in ('cancelled', 'failed')`)) : [];

    let messagesSentLast7Days: number | null = 0;
    try {
      const recipients: string[] = [];
      if (account) {
        const [u] = rows(await db.execute(sql`select email, phone from users where id = ${account}::uuid`));
        if (u?.email) recipients.push(String(u.email).toLowerCase());
        recipients.push(...phoneSpellings(u?.phone ?? null));
      }
      const who: SQL[] = [];
      if (orderIds.length) who.push(sql`(related_entity = 'order' and related_entity_id in (${uuidList(orderIds)}))`);
      if (recipients.length) who.push(sql`lower(recipient) in (${textList(recipients)})`);
      if (who.length) {
        const [m] = rows(await db.execute(sql`
          select count(*)::int as n from notification_attempts
          where status = 'SENT' and attempted_at > now() - interval '7 days' and (${sql.join(who, sql` or `)})`));
        messagesSentLast7Days = Number(m?.n ?? 0);
      }
    } catch {
      messagesSentLast7Days = null;
    }

    return {
      marketingChannels,
      openSupportCases,
      openFraudCases: Number(fraud?.n ?? 0),
      recentPurchaseProductIds: recent.map((r) => String(r.product_id)),
      outOfStockProductIds: recent.filter((r) => String(r.stock_status) === 'out_of_stock').map((r) => String(r.product_id)),
      messagesSentLast7Days,
      loyaltyBalance,
    };
  }
}
