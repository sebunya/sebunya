import { asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { customerIdentityLinks, customerProfiles } from '../db/schema/customer_dna';
import { customerConsentAnchors } from '../db/schema/first-party';
import { categories } from '../db/schema/products';
import { users } from '../db/schema/identity';
import type { CustomerFacts, OrderFact } from '../../domain/first-party/CustomerFacts';
import { normaliseEmail, normalisePhoneE164, ORDER_KEY_PREFIX, VISITOR_FP_PREFIX } from '../../domain/customer-dna/IdentityStitching';
import type { ICustomerContactReader, ICustomerFactsReader, IIdentifierHasher } from '../../application/ports/first-party/FirstPartyPorts';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

/** Bounded inputs: above these the read refuses rather than silently truncating. */
const MAX_PROFILES = 200_000;
const MAX_ORDERS = 500_000;
const BASKET_LOOKBACK_DAYS = 90;

/**
 * Assembles CustomerFacts for every live canonical customer (merged guest
 * profiles are skipped) from the authoritative tables, through ACTIVE identity
 * links only. At GoldPlus's volume (hundreds of customers, ~15 orders a month)
 * one in-memory join is cheaper and clearer than per-rule SQL.
 */
export class DrizzleCustomerFactsReader implements ICustomerFactsReader {
  constructor(private readonly hasher: IIdentifierHasher) {}

  async listCategories() {
    const r = await db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name));
    return r;
  }

  async readAll(_now: Date): Promise<CustomerFacts[]> {
    const profiles = await db.select({ id: customerProfiles.canonicalCustomerId, accountUserId: customerProfiles.accountUserId })
      .from(customerProfiles).where(isNull(customerProfiles.mergedInto)).limit(MAX_PROFILES + 1);
    if (profiles.length > MAX_PROFILES) throw new Error('CUSTOMER_FACTS_INPUT_EXCEEDS_BOUND');
    if (profiles.length === 0) return [];

    const links = await db.select({ canonical: customerIdentityLinks.canonicalCustomerId, signalType: customerIdentityLinks.signalType, key: customerIdentityLinks.identifierKey })
      .from(customerIdentityLinks).where(eq(customerIdentityLinks.status, 'ACTIVE'));

    const live = new Set(profiles.map((p) => p.id));
    const byAccount = new Map<string, string>();
    for (const p of profiles) if (p.accountUserId) byAccount.set(p.accountUserId, p.id);
    const orderOwner = new Map<string, string>();
    const anonOwner = new Map<string, string>();
    const contactOwner = new Map<string, string>();
    for (const l of links) {
      if (!live.has(l.canonical)) continue;
      if (l.signalType === 'ORDER_CUSTOMER_RELATIONSHIP' && l.key.startsWith(ORDER_KEY_PREFIX)) orderOwner.set(l.key.slice(ORDER_KEY_PREFIX.length), l.canonical);
      else if (l.signalType === 'STABLE_ANONYMOUS_ID' && !l.key.includes(':')) anonOwner.set(l.key, l.canonical);
      else if (['CONTACT_EMAIL', 'VERIFIED_EMAIL', 'CONTACT_PHONE', 'VERIFIED_PHONE'].includes(l.signalType)) contactOwner.set(`${l.signalType.endsWith('EMAIL') ? 'e' : 'p'}:${l.key}`, l.canonical);
    }

    const facts = new Map<string, CustomerFacts>();
    for (const p of profiles) facts.set(p.id, { canonicalCustomerId: p.id, accountUserId: p.accountUserId ?? null, orders: [], abandonedBaskets: [], bulkQuotes: [] });

    const orderRows = rows(await db.execute(sql`
      select id, user_id, created_at, total_amount, status, payment_status, payment_method,
        coalesce(nullif(delivery_location->>'district', ''), null) as district
      from orders
      order by created_at asc limit ${MAX_ORDERS + 1}`));
    if (orderRows.length > MAX_ORDERS) throw new Error('CUSTOMER_FACTS_INPUT_EXCEEDS_BOUND');
    const itemRows = rows(await db.execute(sql`
      select distinct oi.order_id, p.category_id from order_items oi join products p on p.id = oi.product_id`));
    const categoriesByOrder = new Map<string, string[]>();
    for (const i of itemRows) {
      const k = String(i.order_id);
      categoriesByOrder.set(k, [...(categoriesByOrder.get(k) ?? []), String(i.category_id)]);
    }
    for (const o of orderRows) {
      const id = String(o.id);
      const owner = orderOwner.get(id) ?? (o.user_id ? byAccount.get(String(o.user_id)) : undefined);
      if (!owner) continue;
      const fact: OrderFact = {
        orderId: id, placedAt: new Date(o.created_at), totalUgx: Number(o.total_amount ?? 0), status: String(o.status), paymentStatus: String(o.payment_status),
        categoryIds: categoriesByOrder.get(id) ?? [],
        paymentMethod: o.payment_method ? String(o.payment_method) : null,
        district: o.district ? String(o.district) : null,
      };
      facts.get(owner)?.orders.push(fact);
    }

    const cartRows = rows(await db.execute(sql`
      select c.id, c.user_id, c.owner_kind, c.owner_id, c.anonymous_id, c.updated_at, count(ci.id)::int as items
      from carts c join cart_items ci on ci.cart_id = c.id
      where c.updated_at > now() - make_interval(days => ${BASKET_LOOKBACK_DAYS})
        and not exists (select 1 from orders o where o.cart_id = c.id)
      group by c.id`));
    for (const c of cartRows) {
      const userId = c.user_id ? String(c.user_id) : c.owner_kind === 'USER' && c.owner_id ? String(c.owner_id) : null;
      const owner = (userId ? byAccount.get(userId) : undefined) ?? (c.anonymous_id ? anonOwner.get(String(c.anonymous_id)) : undefined);
      if (!owner) continue;
      facts.get(owner)?.abandonedBaskets.push({ cartId: String(c.id), updatedAt: new Date(c.updated_at), itemCount: Number(c.items) });
    }

    const quoteRows = rows(await db.execute(sql`
      select reference, email, phone, created_at from quote_requests where reference like 'BQ-%'`));
    for (const q of quoteRows) {
      const email = normaliseEmail(q.email);
      const phone = normalisePhoneE164(q.phone);
      const eh = email ? this.hasher.hash(email) : null;
      const ph = phone ? this.hasher.hash(phone) : null;
      const owner = (eh ? contactOwner.get(`e:${eh}`) : undefined) ?? (ph ? contactOwner.get(`p:${ph}`) : undefined);
      if (!owner) continue;
      facts.get(owner)?.bulkQuotes.push({ reference: String(q.reference), createdAt: new Date(q.created_at) });
    }
    return [...facts.values()];
  }
}

/**
 * First-party contact for audience building. The account's own email and phone
 * win; a guest's are taken from their most recent linked order. Never leaves
 * the API raw: advertising gets hashes only (SegmentAudienceService).
 */
export class DrizzleCustomerContactReader implements ICustomerContactReader {
  async contactsFor(canonicalIds: string[]) {
    const ids = [...new Set(canonicalIds)].slice(0, 100_000);
    if (ids.length === 0) return [];
    const out: Array<{ canonicalCustomerId: string; accountUserId: string | null; email: string | null; phone: string | null; fpClientIds: string[] }> = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const profiles = await db.select({ id: customerProfiles.canonicalCustomerId, accountUserId: customerProfiles.accountUserId })
        .from(customerProfiles).where(inArray(customerProfiles.canonicalCustomerId, chunk));
      const accountIds = profiles.map((p) => p.accountUserId).filter((x): x is string => !!x);
      const accounts = accountIds.length ? await db.select({ id: users.id, email: users.email, phone: users.phone }).from(users).where(inArray(users.id, accountIds)) : [];
      const links = await db.select({ canonical: customerIdentityLinks.canonicalCustomerId, signalType: customerIdentityLinks.signalType, key: customerIdentityLinks.identifierKey })
        .from(customerIdentityLinks).where(inArray(customerIdentityLinks.canonicalCustomerId, chunk));
      // 0157: browsers linked for consent enforcement only (the customer refused
      // personalisation there, so they are not behaviour links). A refusal on any
      // of them must still keep this customer out of audiences.
      const anchors = await db.select({ canonical: customerConsentAnchors.canonicalCustomerId, fp: customerConsentAnchors.fpClientId })
        .from(customerConsentAnchors).where(inArray(customerConsentAnchors.canonicalCustomerId, chunk));
      const orderIds = links.filter((l) => l.signalType === 'ORDER_CUSTOMER_RELATIONSHIP' && l.key.startsWith(ORDER_KEY_PREFIX)).map((l) => l.key.slice(ORDER_KEY_PREFIX.length));
      const orderContacts = orderIds.length
        ? rows(await db.execute(sql`select id, customer_email, customer_phone, created_at from orders where id in (${sql.join(orderIds.map((id) => sql`${id}::uuid`), sql`, `)}) order by created_at desc`))
        : [];
      for (const p of profiles) {
        const acct = accounts.find((a) => a.id === p.accountUserId);
        const mine = new Set(links.filter((l) => l.canonical === p.id && l.signalType === 'ORDER_CUSTOMER_RELATIONSHIP').map((l) => l.key.slice(ORDER_KEY_PREFIX.length)));
        const latest = orderContacts.find((o) => mine.has(String(o.id)));
        out.push({
          canonicalCustomerId: p.id,
          accountUserId: p.accountUserId ?? null,
          email: acct?.email ?? latest?.customer_email ?? null,
          phone: acct?.phone ?? latest?.customer_phone ?? null,
          fpClientIds: [...new Set([
            ...links.filter((l) => l.canonical === p.id && l.key.startsWith(VISITOR_FP_PREFIX)).map((l) => l.key.slice(VISITOR_FP_PREFIX.length)),
            ...anchors.filter((a) => a.canonical === p.id).map((a) => a.fp),
          ])],
        });
      }
    }
    return out;
  }
}
