import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import type { Customer360Order, Customer360Records } from '../../domain/first-party/Customer360';
import type { DeviceEvidence, TraitOrderLine } from '../../domain/first-party/CustomerTraits';
import { normaliseEmail, normalisePhoneE164, ORDER_KEY_PREFIX, VISITOR_FP_PREFIX, VISITOR_PROFILE_PREFIX } from '../../domain/customer-dna/IdentityStitching';
import type { ICustomer360Reader, IIdentifierHasher } from '../../application/ports/first-party/FirstPartyPorts';
import { analysisExclusionsEnabled } from './AnalysisExclusion';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidList = (ids: string[]): SQL => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
const textList = (vals: string[]): SQL => sql.join(vals.map((v) => sql`${v}`), sql`, `);
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

const MAX_ORDERS = 500;
const MAX_VISITS = 50;
const MAX_VIEWS = 500;
const MAX_MESSAGES = 100;

/**
 * Everything ONE customer profile is assembled from (Customer 360, 0157),
 * read from the authoritative tables through the profile's identity links:
 *   - orders: the profile's `order:` links plus the account's own orders;
 *   - contact matches (quotes, battery requests): the stored contact is
 *     normalised and HMAC-hashed exactly as stitching does, then compared with
 *     the profile's CONTACT_/VERIFIED_ keys — a raw contact is never a key;
 *   - behaviour (visits, category views) only through BEHAVIOUR links (xp:/fp:),
 *     which stitching creates only when personalisation is not refused, and
 *     only rows our traffic exclusion has not marked as our own exhaust;
 *   - consent-only browser anchors are read for CONSENT, never for behaviour.
 * Bounded reads throughout; a profile folded into another reads as absent.
 */
export class DrizzleCustomer360Reader implements ICustomer360Reader {
  constructor(private readonly hasher: IIdentifierHasher) {}

  async canonicalForAccount(accountUserId: string): Promise<string | null> {
    const [row] = rows(await db.execute(sql`
      select canonical_customer_id from customer_profiles
      where account_user_id = ${accountUserId}::uuid and merged_into is null
      order by created_at asc limit 1`));
    return row ? String(row.canonical_customer_id) : null;
  }

  async read(canonicalCustomerId: string): Promise<Customer360Records | null> {
    if (!UUID.test(canonicalCustomerId)) return null;
    const [p] = rows(await db.execute(sql`
      select canonical_customer_id, account_user_id, identity_confidence, primary_lifecycle_stage, created_at, merged_into
      from customer_profiles where canonical_customer_id = ${canonicalCustomerId}::uuid`));
    if (!p || p.merged_into) return null;
    const accountUserId = str(p.account_user_id);

    const links = rows(await db.execute(sql`
      select signal_type, status, confidence, identifier_key, created_at from customer_identity_links
      where canonical_customer_id = ${canonicalCustomerId}::uuid order by created_at asc limit 1000`))
      .map((l) => ({ signalType: String(l.signal_type), status: String(l.status), confidence: String(l.confidence), identifierKey: String(l.identifier_key), createdAt: date(l.created_at) }));
    const active = links.filter((l) => l.status === 'ACTIVE');
    const orderIds = active.filter((l) => l.identifierKey.startsWith(ORDER_KEY_PREFIX)).map((l) => l.identifierKey.slice(ORDER_KEY_PREFIX.length)).filter((id) => UUID.test(id));
    const profileIds = active.filter((l) => l.identifierKey.startsWith(VISITOR_PROFILE_PREFIX)).map((l) => l.identifierKey.slice(VISITOR_PROFILE_PREFIX.length)).filter((id) => UUID.test(id));
    const fpIds = active.filter((l) => l.identifierKey.startsWith(VISITOR_FP_PREFIX)).map((l) => l.identifierKey.slice(VISITOR_FP_PREFIX.length));
    const anonIds = active.filter((l) => l.signalType === 'STABLE_ANONYMOUS_ID' && !l.identifierKey.includes(':')).map((l) => l.identifierKey);
    const emailKeys = new Set(active.filter((l) => l.signalType === 'CONTACT_EMAIL' || l.signalType === 'VERIFIED_EMAIL').map((l) => l.identifierKey));
    const phoneKeys = new Set(active.filter((l) => l.signalType === 'CONTACT_PHONE' || l.signalType === 'VERIFIED_PHONE').map((l) => l.identifierKey));

    const [account] = accountUserId ? rows(await db.execute(sql`
      select id, email, phone, phone_verified_at, created_at, is_active from users where id = ${accountUserId}::uuid`)) : [];
    const [counts] = rows(await db.execute(sql`
      select
        (select count(*)::int from customer_profiles where merged_into = ${canonicalCustomerId}::uuid) as folded,
        (select count(*)::int from customer_identity_conflicts where status = 'OPEN'
          and (existing_canonical_id = ${canonicalCustomerId}::uuid or proposed_canonical_id = ${canonicalCustomerId}::uuid)) as conflicts`));

    // ── Orders ───────────────────────────────────────────────────────────
    const orderMatch: SQL[] = [];
    if (accountUserId) orderMatch.push(sql`o.user_id = ${accountUserId}::uuid`);
    if (orderIds.length) orderMatch.push(sql`o.id in (${uuidList(orderIds)})`);
    const orderRows = orderMatch.length ? rows(await db.execute(sql`
      select o.id, o.order_number, o.created_at, o.total_amount, o.status, o.payment_status, o.payment_method, o.cart_id,
             nullif(o.delivery_location->>'district', '') as district, o.customer_name, o.customer_phone, o.customer_email
      from orders o where ${sql.join(orderMatch, sql` or `)}
      order by o.created_at desc limit ${MAX_ORDERS}`)) : [];
    const oids = orderRows.map((o) => String(o.id));
    const lineRows = oids.length ? rows(await db.execute(sql`
      select oi.order_id, oi.product_id, oi.quantity, coalesce(nullif(oi.final_line_total, 0), oi.unit_price * oi.quantity) as line_total,
             p.category_id, coalesce(c.name, p.category_name) as category_name,
             nullif(trim(coalesce(p.specifications->>'brand', p.specifications->>'Brand', '')), '') as brand,
             exists (select 1 from battery_profiles bp where bp.product_id = oi.product_id) as is_battery
      from order_items oi join products p on p.id = oi.product_id left join categories c on c.id = p.category_id
      where oi.order_id in (${uuidList(oids)})`)) : [];
    const creditRows = oids.length ? rows(await db.execute(sql`
      select order_id, model, channel, detail, basis from measurement.order_channel_credit
      where order_id in (${uuidList(oids)}) and model in ('last_click', 'first_touch', 'self_reported')
      order by order_id, model, weight desc`).catch(() => [])) : [];
    const reportRows = oids.length ? rows(await db.execute(sql`
      select distinct on (order_id) order_id, answer, whatsapp_ref from measurement.order_source_report
      where order_id in (${uuidList(oids)}) order by order_id, created_at desc`).catch(() => [])) : [];

    const numberOf = new Map(orderRows.map((o) => [String(o.id), String(o.order_number)]));
    const orders: Customer360Order[] = orderRows.map((o) => {
      const id = String(o.id);
      const lastClick = creditRows.find((c) => String(c.order_id) === id && c.model === 'last_click');
      const selfReported = creditRows.find((c) => String(c.order_id) === id && c.model === 'self_reported');
      const report = reportRows.find((r) => String(r.order_id) === id);
      const lines: TraitOrderLine[] = lineRows.filter((l) => String(l.order_id) === id).map((l) => ({
        productId: String(l.product_id), categoryId: str(l.category_id), categoryName: str(l.category_name), brand: str(l.brand),
        quantity: Number(l.quantity ?? 0), lineTotalUgx: Number(l.line_total ?? 0),
      }));
      return {
        orderId: id, orderNumber: String(o.order_number), placedAt: date(o.created_at), totalUgx: Number(o.total_amount ?? 0),
        status: String(o.status), paymentStatus: String(o.payment_status), paymentMethod: str(o.payment_method), district: str(o.district), lines,
        lastClickChannel: lastClick ? String(lastClick.channel) : null,
        selfReportedChannel: selfReported ? String(selfReported.channel) : null,
        whatsappRef: !!report?.whatsapp_ref,
        contactName: str(o.customer_name), contactPhone: str(o.customer_phone), contactEmail: str(o.customer_email),
      };
    });

    // ── Baskets ──────────────────────────────────────────────────────────
    const cartMatch: SQL[] = [];
    if (accountUserId) cartMatch.push(sql`c.user_id = ${accountUserId}::uuid`, sql`(c.owner_kind = 'USER' and c.owner_id = ${accountUserId})`);
    if (anonIds.length) cartMatch.push(sql`c.anonymous_id in (${textList(anonIds)})`);
    const cartRows = cartMatch.length ? rows(await db.execute(sql`
      select c.id, c.updated_at, count(ci.id)::int as items, exists (select 1 from orders o where o.cart_id = c.id) as converted
      from carts c join cart_items ci on ci.cart_id = c.id
      where ${sql.join(cartMatch, sql` or `)}
      group by c.id order by c.updated_at desc limit 50`)) : [];

    // ── Contact-matched records (hash-compared, never raw-compared) ─────────
    const emailMatches = (v: unknown) => { const e = normaliseEmail(str(v)); const h = e ? this.hasher.hash(e) : null; return !!h && emailKeys.has(h); };
    const phoneMatches = (v: unknown) => { const ph = normalisePhoneE164(str(v)); const h = ph ? this.hasher.hash(ph) : null; return !!h && phoneKeys.has(h); };
    const quoteCandidates = emailKeys.size || phoneKeys.size ? rows(await db.execute(sql`
      select id, reference, email, phone, status, created_at, line_count, total_units, estimated_total_ugx from quote_requests
      order by created_at desc limit 5000`)) : [];
    const myQuotes = quoteCandidates.filter((q) => emailMatches(q.email) || phoneMatches(q.phone)).slice(0, 50);
    const qLines = myQuotes.length ? rows(await db.execute(sql`
      select quote_request_id, product_name, quantity from quote_request_lines
      where quote_request_id in (${uuidList(myQuotes.map((q) => String(q.id)))}) order by line_no`)) : [];
    const requestRows = phoneKeys.size ? rows(await db.execute(sql`
      select br.created_at, br.contact_phone, br.device_text, br.brand_text, br.model_number_text,
             d.brand as resolved_brand, d.model as resolved_model, br.resolved_device_id
      from battery_requests br left join devices d on d.id = br.resolved_device_id
      where br.contact_phone is not null order by br.created_at desc limit 5000`)) : [];

    // ── Devices (estimate evidence) ────────────────────────────────────────
    const devices: DeviceEvidence[] = [];
    for (const r of requestRows.filter((x) => phoneMatches(x.contact_phone)).slice(0, 20)) {
      const label = r.resolved_model ? `${r.resolved_brand ?? ''} ${r.resolved_model}`.trim()
        : [str(r.brand_text), str(r.device_text) ?? str(r.model_number_text)].filter(Boolean).join(' ').trim();
      if (label) devices.push({ deviceId: str(r.resolved_device_id), label: label.slice(0, 120), source: 'BATTERY_REQUEST', at: date(r.created_at) });
    }
    const batteryLines = lineRows.filter((l) => l.is_battery === true || l.is_battery === 't');
    if (batteryLines.length) {
      const productIds = [...new Set(batteryLines.map((l) => String(l.product_id)))];
      const fits = rows(await db.execute(sql`
        select pdc.product_id, d.id as device_id, d.brand, d.model from product_device_compatibility pdc
        join devices d on d.id = pdc.device_id
        where pdc.product_id in (${uuidList(productIds)}) and pdc.workflow_status = 'ACTIVE' and pdc.evidence_status <> 'REJECTED' and d.status = 'ACTIVE'`));
      for (const l of batteryLines) {
        const forProduct = fits.filter((f) => String(f.product_id) === String(l.product_id));
        const order = orders.find((o) => o.orderId === String(l.order_id));
        for (const f of forProduct.slice(0, 10)) {
          devices.push({ deviceId: String(f.device_id), label: `${f.brand} ${f.model}`.trim(), source: 'BATTERY_PURCHASE', at: order?.placedAt ?? new Date(0), fitsDevices: forProduct.length });
        }
      }
    }

    // ── Loyalty, support, messages ─────────────────────────────────────────
    const [loyalty] = accountUserId ? rows(await db.execute(sql`
      select coalesce(sum(e.points), 0)::int as balance, count(e.id)::int as entries
      from loyalty_accounts a left join loyalty_ledger_entries e on e.account_id = a.id
      where a.user_id = ${accountUserId}::uuid group by a.id`)) : [];
    const support = accountUserId ? rows(await db.execute(sql`
      select id, subject, status, type, created_at from support_issues where customer_id = ${accountUserId}::uuid
      order by created_at desc limit 50`)) : [];
    const related: SQL[] = [];
    if (oids.length) related.push(sql`(related_entity = 'order' and related_entity_id in (${uuidList(oids)}))`);
    if (myQuotes.length) related.push(sql`(related_entity = 'quote_request' and related_entity_id in (${uuidList(myQuotes.map((q) => String(q.id)))}))`);
    if (support.length) related.push(sql`(related_entity = 'support_ticket' and related_entity_id in (${uuidList(support.map((s) => String(s.id)))}))`);
    if (accountUserId) related.push(sql`(related_entity in ('user_phone', 'password_reset', 'loyalty') and related_entity_id = ${accountUserId}::uuid)`);
    const messages = related.length ? rows(await db.execute(sql`
      select channel, template, status, attempted_at, related_entity from notification_attempts
      where ${sql.join(related, sql` or `)} order by attempted_at desc limit ${MAX_MESSAGES}`)) : [];

    // ── Behaviour (behaviour links only; our own exhaust excluded) ─────────
    const visits = fpIds.length ? rows(await db.execute(sql`
      select occurred_at, channel, source, landing_path from measurement.touchpoint
      where anonymous_id in (${textList(fpIds)}) and traffic_class = 'customer'
      order by occurred_at desc limit ${MAX_VISITS}`).catch(() => [])) : [];
    const viewMatch: SQL[] = [];
    if (profileIds.length) viewMatch.push(sql`e.profile_id in (${uuidList(profileIds)})`);
    if (accountUserId) viewMatch.push(sql`e.customer_id = ${accountUserId}::uuid`);
    const exclusion = analysisExclusionsEnabled()
      ? sql`and not exists (select 1 from analysis.traffic_exclusion_marks m where m.source_table = 'recommendation_events' and m.row_id = e.id and m.reverted_at is null)`
      : sql``;
    const personalisationRefused = accountUserId ? rows(await db.execute(sql`
      select 1 from consent_current_state where user_id = ${accountUserId}::uuid and personalization_granted = false and last_grant_type <> 'unknown'`)).length > 0 : false;
    const views = viewMatch.length && !personalisationRefused ? rows(await db.execute(sql`
      select coalesce(e.category_id, p.category_id) as category_id, coalesce(c.name, p.category_name) as category_name
      from recommendation_events e
      left join products p on p.id = e.product_id
      left join categories c on c.id = coalesce(e.category_id, p.category_id)
      where (${sql.join(viewMatch, sql` or `)}) and e.event_type in ('PRODUCT_VIEWED', 'CATEGORY_VIEWED') ${exclusion}
      order by e.created_at desc limit ${MAX_VIEWS}`)) : [];
    const [seen] = profileIds.length ? rows(await db.execute(sql`
      select max(last_seen_at) as last_seen from experience_profiles where id in (${uuidList(profileIds)})`)) : [];

    // ── Consents (behaviour links AND consent-only anchors) ────────────────
    const anchorFps = rows(await db.execute(sql`
      select fp_client_id from customer_consent_anchors where canonical_customer_id = ${canonicalCustomerId}::uuid limit 50`)).map((a) => String(a.fp_client_id));
    const consentFps = [...new Set([...fpIds, ...anchorFps])];
    const consentMatch: SQL[] = [];
    if (accountUserId) consentMatch.push(sql`user_id = ${accountUserId}::uuid`);
    if (consentFps.length) consentMatch.push(sql`fp_client_id in (${textList(consentFps)})`);
    const tracking = consentMatch.length ? rows(await db.execute(sql`
      select user_id, analytics_granted, advertising_granted, personalization_granted, last_grant_type, updated_at
      from consent_current_state where ${sql.join(consentMatch, sql` or `)} order by updated_at desc limit 20`)) : [];
    const purposes = accountUserId ? rows(await db.execute(sql`
      select purpose_key, channel_key, state, effective_at from customer_consent_states
      where customer_identity_ref = ${accountUserId} order by effective_at desc limit 50`)) : [];

    // ── Addresses, segments, privacy, finder ───────────────────────────────
    const addresses = accountUserId ? rows(await db.execute(sql`
      select coalesce(nullif(snapshot_district, ''), district) as district from addresses
      where user_id = ${accountUserId}::uuid and deleted_at is null order by is_default desc, created_at desc limit 10`)) : [];
    const segments = rows(await db.execute(sql`
      select s.id, s.key, s.name, m.first_matched_at from customer_segment_members m
      join customer_segments s on s.id = m.segment_id
      where m.canonical_customer_id = ${canonicalCustomerId}::uuid and s.status = 'ACTIVE' order by s.name`));
    const privacy = accountUserId ? rows(await db.execute(sql`
      select reference, kind, status, requested_at from privacy_requests where user_id = ${accountUserId}::uuid
      order by requested_at desc limit 20`).catch(() => [])) : [];
    const finderMatch: SQL[] = [];
    if (accountUserId) finderMatch.push(sql`user_id = ${accountUserId}::uuid`);
    if (anonIds.length) finderMatch.push(sql`anonymous_id in (${textList(anonIds)})`);
    const finder = finderMatch.length && !personalisationRefused ? rows(await db.execute(sql`
      select created_at, status, answers from product_finder_sessions where ${sql.join(finderMatch, sql` or `)}
      order by created_at desc limit 20`)) : [];

    return {
      profile: {
        canonicalCustomerId, accountUserId, identityConfidence: String(p.identity_confidence),
        lifecycleStage: String(p.primary_lifecycle_stage), createdAt: date(p.created_at), mergedInto: null,
      },
      account: account ? {
        id: String(account.id), email: str(account.email), phone: str(account.phone), phoneVerified: !!account.phone_verified_at,
        createdAt: date(account.created_at), isActive: account.is_active === true || account.is_active === 't',
      } : null,
      links,
      foldedProfiles: Number(counts?.folded ?? 0),
      openConflicts: Number(counts?.conflicts ?? 0),
      orders,
      carts: cartRows.map((c) => ({ cartId: String(c.id), updatedAt: date(c.updated_at), itemCount: Number(c.items ?? 0), converted: c.converted === true || c.converted === 't' })),
      quotes: myQuotes.map((q) => ({
        reference: str(q.reference), createdAt: date(q.created_at), status: String(q.status),
        lineCount: q.line_count === null || q.line_count === undefined ? null : Number(q.line_count),
        totalUnits: q.total_units === null || q.total_units === undefined ? null : Number(q.total_units),
        estimatedTotalUgx: q.estimated_total_ugx === null || q.estimated_total_ugx === undefined ? null : Number(q.estimated_total_ugx),
        lines: qLines.filter((l) => String(l.quote_request_id) === String(q.id)).map((l) => ({ productName: String(l.product_name), quantity: Number(l.quantity) })),
      })),
      loyalty: loyalty ? { balance: Number(loyalty.balance ?? 0), entries: Number(loyalty.entries ?? 0) } : null,
      support: support.map((s) => ({ subject: String(s.subject), status: String(s.status), type: String(s.type), createdAt: date(s.created_at) })),
      messages: messages.map((m) => ({ channel: String(m.channel), template: String(m.template), status: String(m.status), at: date(m.attempted_at), relatedEntity: str(m.related_entity) })),
      visits: visits.map((v) => ({ at: date(v.occurred_at), channel: String(v.channel), source: str(v.source), landingPath: str(v.landing_path) })),
      categoryViews: views.map((v) => ({ categoryId: str(v.category_id), categoryName: str(v.category_name) })),
      lastSeenAt: seen?.last_seen ? date(seen.last_seen) : null,
      consents: {
        tracking: tracking.map((t) => ({
          scope: t.user_id ? 'account' as const : 'browser' as const,
          analytics: t.analytics_granted === true, advertising: t.advertising_granted === true, personalisation: t.personalization_granted === true,
          grantType: String(t.last_grant_type), updatedAt: date(t.updated_at),
        })),
        purposes: purposes.map((x) => ({ purposeKey: String(x.purpose_key), channelKey: String(x.channel_key), state: String(x.state), effectiveAt: date(x.effective_at) })),
      },
      attribution: creditRows.map((c) => ({ orderNumber: numberOf.get(String(c.order_id)) ?? '', model: String(c.model), channel: String(c.channel), detail: String(c.detail ?? ''), basis: String(c.basis) })),
      selfReported: reportRows.map((r) => ({ orderNumber: numberOf.get(String(r.order_id)) ?? '', answer: str(r.answer), whatsappRef: str(r.whatsapp_ref) })),
      devices,
      addressDistricts: addresses.map((a) => str(a.district)).filter((d): d is string => !!d),
      segments: segments.map((s) => ({ id: String(s.id), key: String(s.key), name: String(s.name), firstMatchedAt: date(s.first_matched_at) })),
      privacyRequests: privacy.map((x) => ({ reference: String(x.reference), kind: String(x.kind), status: String(x.status), requestedAt: date(x.requested_at) })),
      finderSessions: finder.map((f) => ({ at: date(f.created_at), status: String(f.status), answers: finderAnswers(f.answers) })),
    };
  }
}

/** Only the four declared finder questions; a reference product id is not a need. */
function finderAnswers(raw: unknown): Record<string, string> {
  let obj: unknown = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { obj = {}; } }
  const out: Record<string, string> = {};
  for (const k of ['category', 'problem', 'priority', 'budget']) {
    const v = (obj as Record<string, unknown> | null)?.[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s.trim()) out[k] = s.slice(0, 80);
  }
  return out;
}
