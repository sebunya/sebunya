import { createHash } from 'node:crypto';
import { and, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { customerConsentAnchors, privacyRequests } from '../db/schema/first-party';
import { ORDER_KEY_PREFIX, normaliseEmail, normalisePhoneE164 } from '../../domain/customer-dna/IdentityStitching';
import { offlineSaleHashes, phoneSpellings } from '../../domain/advertising/ContactNormalisation';
import { pgInTextList } from '../db/PgParams';
import { REMOVED_TEXT, erasedEmailFor, isOpenOrder, type PrivacyRequestKind, type PrivacyRequestStatus } from '../../domain/first-party/PrivacyRequests';
import type {
  IConsentAnchorRepository, IIdentifierHasher, IPersonalDataEraser, IPersonalDataExporter, IPrivacyRequestRepository, PrivacyRequestRecord,
} from '../../application/ports/first-party/FirstPartyPorts';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidList = (ids: string[]): SQL => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
const textList = (vals: string[]): SQL => sql.join(vals.map((v) => sql`${v}`), sql`, `);
const iso = (v: unknown) => (v ? new Date(String(v instanceof Date ? v.toISOString() : v)).toISOString() : null);
const affected = (r: unknown): number => Number((r as { count?: number; rowCount?: number })?.count ?? (r as { rowCount?: number })?.rowCount ?? rows(r).length ?? 0);

function toRecord(r: typeof privacyRequests.$inferSelect): PrivacyRequestRecord {
  let result: Record<string, unknown> = {};
  const raw = r.result as unknown;
  if (raw && typeof raw === 'object') result = raw as Record<string, unknown>;
  else if (typeof raw === 'string') { try { result = JSON.parse(raw); } catch { result = {}; } }
  return {
    id: r.id, reference: r.reference, userId: r.userId, kind: r.kind as PrivacyRequestKind, status: r.status as PrivacyRequestStatus,
    customerNote: r.customerNote, requestedAt: r.requestedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt,
    decisionReason: r.decisionReason, completedAt: r.completedAt, result,
  };
}

/**
 * The stored idempotency key, scoped to the customer and the kind of request.
 * The column is unique across ALL customers (0157), so a raw client key could
 * collide with another customer's; a hash of `userId:kind:key` cannot, and it
 * fits the column (64 hex characters) whatever the client sent.
 */
export const scopedIdempotencyKey = (userId: string, kind: string, key: string) =>
  createHash('sha256').update(`${userId}:${kind}:${key}`, 'utf8').digest('hex');

export class DrizzlePrivacyRequestRepository implements IPrivacyRequestRepository {
  async create(raw: Parameters<IPrivacyRequestRepository['create']>[0]) {
    const input = { ...raw, idempotencyKey: raw.idempotencyKey ? scopedIdempotencyKey(raw.userId, raw.kind, raw.idempotencyKey) : raw.idempotencyKey };
    if (input.idempotencyKey) {
      const [same] = await db.select().from(privacyRequests).where(eq(privacyRequests.idempotencyKey, input.idempotencyKey)).limit(1);
      if (same && same.userId === input.userId && same.kind === input.kind) return { record: toRecord(same), created: false };
    }
    if (input.status === 'RECEIVED') {
      const [open] = await db.select().from(privacyRequests)
        .where(and(eq(privacyRequests.userId, input.userId), eq(privacyRequests.kind, input.kind), eq(privacyRequests.status, 'RECEIVED'))).limit(1);
      if (open) return { record: toRecord(open), created: false };
    }
    const now = new Date();
    const [row] = await db.insert(privacyRequests).values({
      reference: input.reference, userId: input.userId, kind: input.kind, status: input.status,
      customerNote: input.customerNote, idempotencyKey: input.idempotencyKey,
      result: input.result ?? {}, completedAt: input.status === 'COMPLETED' ? now : null,
    }).onConflictDoNothing().returning();
    if (row) return { record: toRecord(row), created: true };
    // Lost a race on the open-request index or the idempotency key: return the winner.
    const [winner] = await db.select().from(privacyRequests)
      .where(and(eq(privacyRequests.userId, input.userId), eq(privacyRequests.kind, input.kind)))
      .orderBy(desc(privacyRequests.requestedAt)).limit(1);
    if (!winner) throw new Error('PRIVACY_REQUEST_NOT_RECORDED');
    return { record: toRecord(winner), created: false };
  }

  async findById(id: string) {
    if (!UUID.test(id)) return null;
    const [row] = await db.select().from(privacyRequests).where(eq(privacyRequests.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async listForUser(userId: string, limit: number) {
    return (await db.select().from(privacyRequests).where(eq(privacyRequests.userId, userId)).orderBy(desc(privacyRequests.requestedAt)).limit(limit)).map(toRecord);
  }

  async list(input: { status?: PrivacyRequestStatus | null; limit: number }) {
    const q = db.select().from(privacyRequests);
    const filtered = input.status ? q.where(eq(privacyRequests.status, input.status)) : q.where(sql`${privacyRequests.kind} <> 'EXPORT'`);
    return (await filtered.orderBy(desc(privacyRequests.requestedAt)).limit(input.limit)).map(toRecord);
  }

  async countExportsSince(userId: string, since: Date) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(privacyRequests)
      .where(and(eq(privacyRequests.userId, userId), eq(privacyRequests.kind, 'EXPORT'), gte(privacyRequests.requestedAt, since)));
    return Number(r?.n ?? 0);
  }

  async transition(id: string, input: { to: Exclude<PrivacyRequestStatus, 'RECEIVED'>; actorId: string | null; reason: string | null; result?: Record<string, unknown> }) {
    const now = new Date();
    const updated = await db.update(privacyRequests).set({
      status: input.to, decidedBy: input.actorId && UUID.test(input.actorId) ? input.actorId : null, decidedAt: now,
      decisionReason: input.reason, completedAt: input.to === 'COMPLETED' ? now : null,
      ...(input.result ? { result: input.result } : {}),
    }).where(and(eq(privacyRequests.id, id), eq(privacyRequests.status, 'RECEIVED'))).returning({ id: privacyRequests.id });
    return updated.length === 1;
  }
}

export class DrizzleConsentAnchorRepository implements IConsentAnchorRepository {
  async record(input: { canonicalCustomerId: string; fpClientId: string; reason: 'PERSONALISATION_REFUSED' | 'CONSENT_UNREADABLE' }) {
    await db.insert(customerConsentAnchors).values(input).onConflictDoNothing();
  }
}

/**
 * The customer's orders and contact keys, the way the Customer 360 finds them:
 * their account's orders plus every order linked to their customer profile.
 */
async function ownedOrderIds(exec: typeof db, userId: string): Promise<string[]> {
  const linked = rows(await exec.execute(sql`
    select l.identifier_key from customer_identity_links l
    join customer_profiles p on p.canonical_customer_id = l.canonical_customer_id
    where p.account_user_id = ${userId}::uuid and l.signal_type = 'ORDER_CUSTOMER_RELATIONSHIP' and l.status = 'ACTIVE'`))
    .map((r) => String(r.identifier_key)).filter((k) => k.startsWith(ORDER_KEY_PREFIX)).map((k) => k.slice(ORDER_KEY_PREFIX.length)).filter((id) => UUID.test(id));
  const own = rows(await exec.execute(sql`select id from orders where user_id = ${userId}::uuid`)).map((r) => String(r.id));
  return [...new Set([...own, ...linked])];
}

async function contactKeys(exec: typeof db, userId: string): Promise<{ email: Set<string>; phone: Set<string> }> {
  const links = rows(await exec.execute(sql`
    select l.signal_type, l.identifier_key from customer_identity_links l
    join customer_profiles p on p.canonical_customer_id = l.canonical_customer_id
    where p.account_user_id = ${userId}::uuid and l.status = 'ACTIVE'
      and l.signal_type in ('CONTACT_EMAIL', 'VERIFIED_EMAIL', 'CONTACT_PHONE', 'VERIFIED_PHONE')`));
  return {
    email: new Set(links.filter((l) => String(l.signal_type).endsWith('EMAIL')).map((l) => String(l.identifier_key))),
    phone: new Set(links.filter((l) => String(l.signal_type).endsWith('PHONE')).map((l) => String(l.identifier_key))),
  };
}

/** The customer's known contacts in plain form, the way the SQL matchers compare them. */
function plainContacts(values: Array<{ email?: unknown; phone?: unknown }>): { emails: string[]; phoneDigits: string[] } {
  const emails = new Set<string>();
  const phoneDigits = new Set<string>();
  for (const v of values) {
    const e = normaliseEmail(typeof v.email === 'string' ? v.email : null);
    if (e) emails.add(e);
    for (const p of phoneSpellings(typeof v.phone === 'string' ? v.phone : null)) if (!p.startsWith('+')) phoneDigits.add(p);
  }
  return { emails: [...emails], phoneDigits: [...phoneDigits] };
}

const phoneIn = (col: SQL, digits: string[]) => pgInTextList(sql`regexp_replace(coalesce(${col}, ''), '\\D', '', 'g')`, digits);
const emailIn = (col: SQL, emails: string[]) => pgInTextList(sql`lower(trim(coalesce(${col}, '')))`, emails);
const HASH_SCAN_PAGE = 2000;

/**
 * Ids of the rows of `table` that belong to the customer, with NO row limit:
 *  1. matched in SQL on their known contacts (email lower/trimmed; phone by
 *     its digits in every spelling);
 *  2. then, as an extra check, every remaining row is read in pages and
 *     compared with the keyed hashes of contacts known only as identity keys.
 * Nothing outside a window is ever silently skipped.
 */
async function matchingIds(
  exec: typeof db, table: 'quote_requests' | 'battery_requests', plain: { emails: string[]; phoneDigits: string[] },
  match: ReturnType<typeof matcher>, hashedKeysExist: boolean,
): Promise<string[]> {
  const t = sql.raw(table);
  const phoneCol = table === 'quote_requests' ? sql.raw('phone') : sql.raw('contact_phone');
  const emailCond = table === 'quote_requests' ? emailIn(sql.raw('email'), plain.emails) : sql`false`;
  const ids = new Set(rows(await exec.execute(sql`select id from ${t} where ${phoneIn(phoneCol, plain.phoneDigits)} or ${emailCond}`)).map((r) => String(r.id)));
  if (!hashedKeysExist) return [...ids];
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const page = rows(await exec.execute(table === 'quote_requests'
      ? sql`select id, email, phone from quote_requests where id > ${after}::uuid order by id limit ${HASH_SCAN_PAGE}`
      : sql`select id, contact_phone as phone from battery_requests where contact_phone is not null and id > ${after}::uuid order by id limit ${HASH_SCAN_PAGE}`));
    for (const r of page) if ((table === 'quote_requests' && match.email(r.email)) || match.phone(r.phone)) ids.add(String(r.id));
    if (page.length < HASH_SCAN_PAGE) break;
    after = String(page[page.length - 1].id);
  }
  return [...ids];
}

/** Rows whose stored contact hashes to one of the customer's keys (quotes, battery requests). */
function matcher(hasher: IIdentifierHasher, keys: { email: Set<string>; phone: Set<string> }, account: { email: string | null; phone: string | null } | null) {
  const accEmail = normaliseEmail(account?.email ?? null);
  const accPhone = normalisePhoneE164(account?.phone ?? null);
  return {
    email(v: unknown) {
      const e = normaliseEmail(typeof v === 'string' ? v : null);
      if (!e) return false;
      if (accEmail && e === accEmail) return true;
      const h = hasher.hash(e);
      return !!h && keys.email.has(h);
    },
    phone(v: unknown) {
      const p = normalisePhoneE164(typeof v === 'string' ? v : null);
      if (!p) return false;
      if (accPhone && p === accPhone) return true;
      const h = hasher.hash(p);
      return !!h && keys.phone.has(h);
    },
  };
}

/**
 * A portable copy of what GoldPlus holds about a signed-in customer. Supplier
 * cost (the frozen cost column on order lines), fraud cases, staff notes and
 * other customers' data are never selected.
 */
export class DrizzlePersonalDataExporter implements IPersonalDataExporter {
  constructor(private readonly hasher: IIdentifierHasher) {}

  async collect(userId: string) {
    if (!UUID.test(userId)) return null;
    const [user] = rows(await db.execute(sql`
      select email, phone, phone_verified_at, created_at, date_of_birth, referral_code, is_active from users where id = ${userId}::uuid`));
    if (!user) return null;
    const orderIds = await ownedOrderIds(db, userId);
    const keys = await contactKeys(db, userId);
    const match = matcher(this.hasher, keys, { email: user.email ?? null, phone: user.phone ?? null });

    const addresses = rows(await db.execute(sql`
      select label, recipient_name, phone, phone_secondary, district, area_details, landmark_text, additional_directions,
             gps_lat, gps_lng, delivery_method, is_default, created_at
      from addresses where user_id = ${userId}::uuid and deleted_at is null order by created_at`));
    const orders = orderIds.length ? rows(await db.execute(sql`
      select id, order_number, created_at, status, payment_status, payment_method, customer_name, customer_phone, customer_email,
             delivery_area, delivery_address, delivery_location, subtotal_amount, delivery_fee, loyalty_discount_ugx, total_amount
      from orders where id in (${uuidList(orderIds)}) order by created_at`)) : [];
    const items = orderIds.length ? rows(await db.execute(sql`
      select order_id, product_name, sku, quantity, unit_price, discount_amount, final_line_total
      from order_items where order_id in (${uuidList(orderIds)})`)) : [];
    const attribution = orderIds.length ? rows(await db.execute(sql`
      select order_id, source, medium, campaign, landing_path, referrer, first_at, client_ip, user_agent
      from order_attribution where order_id in (${uuidList(orderIds)})`)) : [];
    const orderContacts = orderIds.length ? rows(await db.execute(sql`select customer_email as email, customer_phone as phone from orders where id in (${uuidList(orderIds)})`)) : [];
    const plain = plainContacts([{ email: user.email, phone: user.phone }, ...orderContacts]);
    const hashedKeys = keys.email.size + keys.phone.size > 0;
    const quoteIds = await matchingIds(db, 'quote_requests', plain, match, hashedKeys);
    const quotes = quoteIds.length ? rows(await db.execute(sql`
      select id, reference, customer_name, email, phone, business_name, product_name, quantity, message, status, delivery_district, created_at
      from quote_requests where id in (${uuidList(quoteIds)}) order by created_at desc`)) : [];
    const quoteLines = quotes.length ? rows(await db.execute(sql`
      select quote_request_id, product_name, product_code, quantity, unit_price_ugx, line_total_ugx
      from quote_request_lines where quote_request_id in (${uuidList(quotes.map((q) => String(q.id)))}) order by line_no`)) : [];
    const batteryIds = await matchingIds(db, 'battery_requests', plain, match, hashedKeys);
    const batteryRequests = batteryIds.length ? rows(await db.execute(sql`
      select created_at, query_text, brand_text, device_text, model_number_text, contact_name, contact_phone, notes, status
      from battery_requests where id in (${uuidList(batteryIds)}) order by created_at desc`)) : [];
    const loyalty = rows(await db.execute(sql`
      select e.type, e.points, e.reason, e.created_at, e.expires_at from loyalty_ledger_entries e
      join loyalty_accounts a on a.id = e.account_id where a.user_id = ${userId}::uuid order by e.created_at`));
    const support = rows(await db.execute(sql`
      select subject, description, status, type, created_at from support_issues where customer_id = ${userId}::uuid order by created_at`));
    const tracking = rows(await db.execute(sql`
      select analytics_granted, advertising_granted, personalization_granted, last_grant_type, updated_at
      from consent_current_state where user_id = ${userId}::uuid`));
    const consentHistory = rows(await db.execute(sql`
      select purpose_key, channel_key, event_type, new_state, source_surface, created_at from consent_events
      where customer_identity_ref = ${userId} order by created_at`).catch(() => []));
    const messages = orderIds.length ? rows(await db.execute(sql`
      select channel, template, status, attempted_at from notification_attempts
      where related_entity = 'order' and related_entity_id in (${uuidList(orderIds)}) order by attempted_at`)) : [];
    const finder = rows(await db.execute(sql`
      select created_at, status, answers from product_finder_sessions where user_id = ${userId}::uuid order by created_at`));
    const identity = rows(await db.execute(sql`
      select l.signal_type, l.confidence, l.status, l.created_at from customer_identity_links l
      join customer_profiles p on p.canonical_customer_id = l.canonical_customer_id
      where p.account_user_id = ${userId}::uuid order by l.created_at`));
    const segments = rows(await db.execute(sql`
      select s.name, m.first_matched_at from customer_segment_members m
      join customer_segments s on s.id = m.segment_id
      join customer_profiles p on p.canonical_customer_id = m.canonical_customer_id
      where p.account_user_id = ${userId}::uuid`));
    const requests = rows(await db.execute(sql`
      select reference, kind, status, requested_at, completed_at from privacy_requests where user_id = ${userId}::uuid order by requested_at`));

    const sections = {
      account: {
        email: user.email, phone: user.phone, phoneVerified: !!user.phone_verified_at, createdAt: iso(user.created_at),
        dateOfBirth: user.date_of_birth ?? null, referralCode: user.referral_code ?? null, active: user.is_active === true || user.is_active === 't',
      },
      addresses: addresses.map((a) => ({
        label: a.label, recipientName: a.recipient_name, phone: a.phone, secondPhone: a.phone_secondary, district: a.district,
        area: a.area_details, landmark: a.landmark_text, directions: a.additional_directions,
        location: a.gps_lat !== null && a.gps_lat !== undefined ? { lat: Number(a.gps_lat), lng: Number(a.gps_lng) } : null,
        deliveryMethod: a.delivery_method, isDefault: a.is_default === true || a.is_default === 't', createdAt: iso(a.created_at),
      })),
      orders: orders.map((o) => ({
        orderNumber: o.order_number, placedAt: iso(o.created_at), status: o.status, paymentStatus: o.payment_status, paymentMethod: o.payment_method,
        name: o.customer_name, phone: o.customer_phone, email: o.customer_email, deliveryArea: o.delivery_area, deliveryAddress: o.delivery_address,
        deliveryLocation: o.delivery_location ?? null,
        amounts: { subtotalUgx: Number(o.subtotal_amount), deliveryFeeUgx: Number(o.delivery_fee), pointsDiscountUgx: Number(o.loyalty_discount_ugx ?? 0), totalUgx: Number(o.total_amount) },
        items: items.filter((i) => String(i.order_id) === String(o.id)).map((i) => ({
          product: i.product_name, sku: i.sku, quantity: Number(i.quantity), unitPriceUgx: Number(i.unit_price),
          discountUgx: Number(i.discount_amount ?? 0), lineTotalUgx: Number(i.final_line_total ?? 0),
        })),
        howYouFoundUs: (() => {
          const a = attribution.find((x) => String(x.order_id) === String(o.id));
          return a ? { source: a.source, medium: a.medium, campaign: a.campaign, landingPage: a.landing_path, referrer: a.referrer, firstVisit: iso(a.first_at), ipAddress: a.client_ip, browser: a.user_agent } : null;
        })(),
      })),
      quoteRequests: quotes.map((q) => ({
        reference: q.reference, name: q.customer_name, email: q.email, phone: q.phone, business: q.business_name,
        product: q.product_name, quantity: q.quantity, message: q.message, status: q.status, deliveryDistrict: q.delivery_district, createdAt: iso(q.created_at),
        lines: quoteLines.filter((l) => String(l.quote_request_id) === String(q.id)).map((l) => ({ product: l.product_name, code: l.product_code, quantity: Number(l.quantity), unitPriceUgx: l.unit_price_ugx === null ? null : Number(l.unit_price_ugx), lineTotalUgx: l.line_total_ugx === null ? null : Number(l.line_total_ugx) })),
      })),
      batteryRequests: batteryRequests.map((b) => ({ createdAt: iso(b.created_at), searchedFor: b.query_text, brand: b.brand_text, phone: b.device_text, modelNumber: b.model_number_text, contactName: b.contact_name, contactPhone: b.contact_phone, notes: b.notes, status: b.status })),
      loyaltyPoints: loyalty.map((l) => ({ type: l.type, points: Number(l.points), reason: l.reason, createdAt: iso(l.created_at), expiresAt: iso(l.expires_at) })),
      supportRequests: support.map((s) => ({ subject: s.subject, description: s.description, status: s.status, type: s.type, createdAt: iso(s.created_at) })),
      consent: {
        trackingChoices: tracking.map((t) => ({ analytics: t.analytics_granted, advertising: t.advertising_granted, personalisation: t.personalization_granted, how: t.last_grant_type, updatedAt: iso(t.updated_at) })),
        history: consentHistory.map((c) => ({ purpose: c.purpose_key, channel: c.channel_key, event: c.event_type, state: c.new_state, where: c.source_surface, at: iso(c.created_at) })),
      },
      messagesAboutYourOrders: messages.map((m) => ({ channel: m.channel, template: m.template, status: m.status, at: iso(m.attempted_at) })),
      productFinder: finder.map((f) => ({ at: iso(f.created_at), status: f.status, answers: f.answers })),
      identityRecords: identity.map((l) => ({ kind: l.signal_type, confidence: l.confidence, status: l.status, linkedAt: iso(l.created_at), note: 'Stored as a keyed hash or an id, never as your email or phone.' })),
      customerGroups: segments.map((s) => ({ group: s.name, since: iso(s.first_matched_at) })),
      privacyRequests: requests.map((r) => ({ reference: r.reference, kind: r.kind, status: r.status, requestedAt: iso(r.requested_at), completedAt: iso(r.completed_at) })),
    };
    const counts: Record<string, number> = {
      addresses: addresses.length, orders: orders.length, quoteRequests: quotes.length, batteryRequests: batteryRequests.length,
      loyaltyEntries: loyalty.length, supportRequests: support.length, messages: messages.length, identityRecords: identity.length,
    };
    return { sections, counts };
  }
}

/**
 * Carries out an erasure (0157) in ONE transaction, and marks the request
 * COMPLETED in the same transaction (only if it is still RECEIVED).
 *
 * ANONYMISE_HISTORY and DELETE_ACCOUNT both:
 *   - orders: name, phone, email, address text and the precise location are
 *     removed; the district, amounts, items and statuses stay (sales records);
 *   - order attribution: IP address, browser, browser id and ad click ids removed;
 *   - offline conversions still waiting to be sent for their orders or their
 *     admin-recorded sales: SUPPRESSED (reason ERASED), never sent;
 *   - quote requests and battery requests matched to the customer: contact removed;
 *   - support tickets: description removed;
 *   - message log and outbox payloads for their orders: recipient removed;
 *   - admin-recorded offline sales for their orders: contact hashes removed;
 *   - identity: every contact and browser link of their profile is deleted (the
 *     keys ARE their contact, hashed). Consent-only browser anchors are KEPT:
 *     they hold browser ids only and exist to keep enforcing a refusal (the
 *     account stays open after ANONYMISE_HISTORY).
 * Quote and battery requests are matched in SQL with no row limit (plus a
 * paged scan against the keyed identity hashes), so nothing outside a window
 * is left behind while the request says COMPLETED.
 * Platform audience lists that already hold the customer are corrected at the
 * next daily audience sync (docs/advertising/README.md).
 * DELETE_ACCOUNT also closes the account: email replaced by an undeliverable
 * placeholder, phone, password, birthday and referral code removed, saved
 * addresses blanked and marked deleted, every session revoked.
 * Consent records are KEPT: they are the evidence of what the customer agreed to.
 */
export class DrizzlePersonalDataEraser implements IPersonalDataEraser {
  constructor(private readonly hasher: IIdentifierHasher) {}

  async openOrderCount(userId: string): Promise<number> {
    if (!UUID.test(userId)) return 0;
    const ids = await ownedOrderIds(db, userId);
    if (!ids.length) return 0;
    const statuses = rows(await db.execute(sql`select status from orders where id in (${uuidList(ids)})`));
    return statuses.filter((s) => isOpenOrder(String(s.status))).length;
  }

  async erase(input: { userId: string; kind: 'ANONYMISE_HISTORY' | 'DELETE_ACCOUNT'; requestId: string; actorId: string; reason: string }) {
    if (!UUID.test(input.userId) || !UUID.test(input.requestId)) throw new Error('PRIVACY_ERASE_BAD_INPUT');
    return db.transaction(async (tx) => {
      const exec = tx as unknown as typeof db;
      // Claim the request first: a concurrent second click finds it closed and changes nothing.
      const claimed = rows(await exec.execute(sql`
        update privacy_requests set status = 'COMPLETED', decided_by = ${UUID.test(input.actorId) ? input.actorId : null}::uuid,
          decided_at = now(), completed_at = now(), decision_reason = ${input.reason}
        where id = ${input.requestId}::uuid and status = 'RECEIVED' and user_id = ${input.userId}::uuid returning id`));
      if (claimed.length !== 1) return { completed: false, counts: {} };

      const counts: Record<string, number> = {};
      const [user] = rows(await exec.execute(sql`select email, phone from users where id = ${input.userId}::uuid for update`));
      const orderIds = await ownedOrderIds(exec, input.userId);
      const keys = await contactKeys(exec, input.userId);
      const match = matcher(this.hasher, keys, user ? { email: user.email ?? null, phone: user.phone ?? null } : null);

      // Read before the orders are blanked: their contacts find the customer's quote and battery requests.
      const contacts = orderIds.length ? rows(await exec.execute(sql`select customer_email, customer_phone from orders where id in (${uuidList(orderIds)})`)) : [];
      const plain = plainContacts([{ email: user?.email, phone: user?.phone }, ...contacts.map((c) => ({ email: c.customer_email, phone: c.customer_phone }))]);
      if (orderIds.length) {
        counts.orders = affected(await exec.execute(sql`
          update orders set customer_name = ${REMOVED_TEXT}, customer_phone = '', customer_email = null,
            delivery_address = ${REMOVED_TEXT},
            delivery_location = case when jsonb_typeof(delivery_location) = 'object'
              then jsonb_strip_nulls(jsonb_build_object('district', delivery_location->'district', 'removed', true)) else null end,
            delivery_location_raw = null, anonymous_id = null, browser_id = null, session_id = null, updated_at = now()
          where id in (${uuidList(orderIds)})`));
        counts.orderAttribution = affected(await exec.execute(sql`
          update order_attribution set client_ip = null, user_agent = null, fp_client_id = null, click_ids = null
          where order_id in (${uuidList(orderIds)})`));
        counts.messageLog = affected(await exec.execute(sql`
          update notification_attempts set recipient = 'removed'
          where related_entity = 'order' and related_entity_id in (${uuidList(orderIds)})`));
        counts.outboxPayloads = affected(await exec.execute(sql`
          update outbox_events set payload = payload - 'customerPhone' - 'customerEmail' - 'customerName' - 'phone' - 'email'
          where related_entity = 'order' and related_entity_id in (${uuidList(orderIds)}) and jsonb_typeof(payload) = 'object'`));
      }

      // Admin-recorded sales and waiting offline conversions: by order, and by
      // the contact hashes (a sale recorded by phone may name no order).
      const hashes = new Set<string>();
      for (const c of [...contacts, { customer_email: user?.email, customer_phone: user?.phone }]) {
        const h = offlineSaleHashes({ email: c.customer_email ?? null, phone: c.customer_phone ?? null });
        for (const v of Object.values(h)) if (v) hashes.add(v);
      }
      const byOrder = orderIds.length ? sql`order_id in (${uuidList(orderIds)})` : sql`false`;
      const byHash = hashes.size ? sql`or email_sha256 in (${textList([...hashes])}) or email_google_sha256 in (${textList([...hashes])})
             or phone_digits_sha256 in (${textList([...hashes])}) or phone_plus_sha256 in (${textList([...hashes])})` : sql``;
      // Before the sales lose their hashes (the hashes find them): nothing still
      // waiting is ever sent to an ad platform for this customer.
      counts.offlineConversionsSuppressed = affected(await exec.execute(sql`
        update ad_offline_conversions set state = 'SUPPRESSED', reason = 'ERASED', updated_at = now()
        where state = 'PENDING' and (
          (source = 'COD_DELIVERED' and ${orderIds.length ? sql`source_ref in (${textList(orderIds)})` : sql`false`})
          or (source = 'ADMIN_SALE' and source_ref in (select id::text from ad_offline_sales where ${byOrder} ${byHash})))`));
      counts.offlineSales = affected(await exec.execute(sql`
        update ad_offline_sales set email_sha256 = null, email_google_sha256 = null, phone_digits_sha256 = null, phone_plus_sha256 = null
        where ${byOrder} ${byHash}`));

      const recipients = [...phoneSpellings(user?.phone ?? null), ...(user?.email ? [String(user.email).toLowerCase()] : [])];
      if (recipients.length) {
        counts.messageLog = (counts.messageLog ?? 0) + affected(await exec.execute(sql`
          update notification_attempts set recipient = 'removed' where lower(recipient) in (${textList(recipients)})`));
      }

      const hashedKeys = keys.email.size + keys.phone.size > 0;
      const quotes = await matchingIds(exec, 'quote_requests', plain, match, hashedKeys);
      counts.quoteRequests = quotes.length ? affected(await exec.execute(sql`
        update quote_requests set customer_name = ${REMOVED_TEXT}, email = '', phone = '', business_name = null, message = null,
          anonymous_id = null, browser_id = null, session_id = null, updated_at = now()
        where id in (${uuidList(quotes)})`)) : 0;
      const batteryReqs = await matchingIds(exec, 'battery_requests', plain, match, hashedKeys);
      counts.batteryRequests = batteryReqs.length ? affected(await exec.execute(sql`
        update battery_requests set contact_name = null, contact_phone = null, notes = null where id in (${uuidList(batteryReqs)})`)) : 0;
      counts.supportRequests = affected(await exec.execute(sql`
        update support_issues set description = ${REMOVED_TEXT}, metadata = '{}'::jsonb where customer_id = ${input.userId}::uuid`));

      counts.identityLinks = affected(await exec.execute(sql`
        delete from customer_identity_links l using customer_profiles p
        where p.canonical_customer_id = l.canonical_customer_id and p.account_user_id = ${input.userId}::uuid
          and l.signal_type in ('CONTACT_EMAIL', 'VERIFIED_EMAIL', 'CONTACT_PHONE', 'VERIFIED_PHONE', 'STABLE_ANONYMOUS_ID')`));
      counts.productFinder = affected(await exec.execute(sql`
        update product_finder_sessions set anonymous_id = null where user_id = ${input.userId}::uuid`));

      if (input.kind === 'DELETE_ACCOUNT') {
        counts.account = affected(await exec.execute(sql`
          update users set email = ${erasedEmailFor(input.userId)}, phone = null, password_hash = null, date_of_birth = null,
            referral_code = null, phone_verified_at = null, is_active = false, sessions_invalidated_after = now()
          where id = ${input.userId}::uuid`));
        counts.addresses = affected(await exec.execute(sql`
          update addresses set recipient_name = ${REMOVED_TEXT}, phone = '', phone_secondary = null, area_details = ${REMOVED_TEXT},
            landmark_text = null, additional_directions = null, raw_address_text = null, gps_lat = null, gps_lng = null,
            gps_accuracy_m = null, deleted_at = coalesce(deleted_at, now()), updated_at = now()
          where user_id = ${input.userId}::uuid`));
        counts.sessions = affected(await exec.execute(sql`
          update auth_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = ${input.userId}::uuid`));
      }

      await exec.execute(sql`update privacy_requests set result = ${JSON.stringify({ counts })}::text::jsonb where id = ${input.requestId}::uuid`);
      return { completed: true, counts };
    });
  }
}
