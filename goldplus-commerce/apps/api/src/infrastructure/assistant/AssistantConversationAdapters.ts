import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { outboxEvents } from '../db/schema/system';
import { pgInTextList, pgJsonb } from '../db/PgParams';
import type { HeroSignalsService } from '../hero/HeroSignalsService';
import type {
  AssistantInterest, AssistantShopperContext, AssistantShopperKey,
  IAssistantContextReader, IAssistantInterestSink, IAssistantMailOutbox, PreRenderedMail,
} from '../../application/ports/IAssistantConversationPorts';
import type { ZeroPartySignal } from '@goldplus/shared';

const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;

/**
 * An outbox row whose payload is a real JSON object. drizzle-orm 0.29 with postgres-js double-encodes jsonb
 * on insert (the column holds a JSON *string*); Drizzle's own reads parse it back, so most code never notices,
 * but SQL that looks inside the payload (payload->>'recipient') sees nothing. The chat-copy daily cap and its
 * index (0180) read the recipient that way, so these rows are written with pgJsonb() (text cast to jsonb, the
 * repo's own helper; a bare ::jsonb parameter makes postgres-js encode the JSON string a second time).
 */
export async function insertOutboxObject(row: { eventType: string; template: string; channel: string; idempotencyKey: string; relatedEntity: string; relatedEntityId: string | null; payload: Record<string, unknown> }): Promise<string | null> {
  const rows = rowsOf(await db.execute(sql`
    insert into outbox_events (event_type, payload, idempotency_key, status, channel, template, dry_run_only, related_entity, related_entity_id)
    values (${row.eventType}, ${pgJsonb(row.payload)}, ${row.idempotencyKey}, 'pending', ${row.channel}, ${row.template}, false, ${row.relatedEntity}, ${row.relatedEntityId}::uuid)
    on conflict (idempotency_key) do nothing
    returning id
  `));
  return rows[0]?.id ? String(rows[0].id) : null;
}

/**
 * A field inside a jsonb payload written either way: as an object, or double-encoded by Drizzle as a JSON string
 * (zero_party_signals rows come from the shared capture path, which writes through Drizzle).
 */
const payloadField = (field: string) => sql.raw(`coalesce(payload->>'${field}', case when jsonb_typeof(payload) = 'string' then (payload #>> '{}')::jsonb->>'${field}' end)`);

/** Where Goldie's interests live in zero_party_signals (signal_type declared_intent). */
export const GOLDIE_SOURCE_COMPONENT = 'goldie_chat';

/** Pre-rendered chat emails through the same outbox, governance and provider as every other email. */
export class DrizzleAssistantMailOutbox implements IAssistantMailOutbox {
  async enqueue(mail: PreRenderedMail): Promise<{ enqueued: boolean }> {
    // Delivery is governed downstream (live-send switches, classification); this row is a real intent.
    const id = await insertOutboxObject({
      eventType: mail.eventType, template: mail.eventType, channel: 'email', idempotencyKey: mail.idempotencyKey,
      relatedEntity: mail.relatedEntity, relatedEntityId: mail.relatedEntityId,
      payload: { recipient: mail.recipient, subject: mail.subject, text: mail.text, html: mail.html, replyTo: mail.replyTo ?? null, replyToName: mail.replyToName ?? null, relatedEntity: mail.relatedEntity, relatedEntityId: mail.relatedEntityId },
    });
    return { enqueued: id !== null };
  }

  async countTranscriptsSince(recipient: string, since: Date): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(outboxEvents).where(and(
      eq(outboxEvents.eventType, 'GOLDIE_TRANSCRIPT'),
      gte(outboxEvents.createdAt, since),
      sql`lower(${outboxEvents.payload}->>'recipient') = ${recipient.toLowerCase()}`,
    ));
    return Number(rows[0]?.n ?? 0);
  }
}

/**
 * What Goldie may know about the shopper: the hero's own signals (visits,
 * orders, first name, interests) plus the products they looked at last and
 * what they asked Goldie before. First-party, read-only, never cached.
 */
export class DrizzleAssistantContextReader implements IAssistantContextReader {
  constructor(private readonly hero: HeroSignalsService) {}

  async read(key: AssistantShopperKey): Promise<AssistantShopperContext> {
    const signals = await this.hero.getSignals(key.profileId, []);
    const slugs = signals.categoryAffinity.slice(0, 3).map((a) => a.categorySlug);
    const [categories, viewed, topics, accountName] = await Promise.all([
      slugs.length ? this.categoryNames(slugs) : Promise.resolve([] as string[]),
      key.profileId ? this.recentlyViewed(key.profileId) : Promise.resolve([] as string[]),
      this.pastTopics(key),
      !signals.customer?.firstName && key.userId ? this.accountFirstName(key.userId) : Promise.resolve(null),
    ]);
    return {
      firstName: tidyName(signals.customer?.firstName ?? accountName),
      visits: signals.visits,
      hasOrdered: signals.hasOrdered,
      topCategories: categories,
      recentlyViewed: viewed,
      pastTopics: topics,
    };
  }

  private async categoryNames(slugs: string[]): Promise<string[]> {
    const rows = rowsOf(await db.execute(sql`select slug, name from categories where ${pgInTextList(sql`slug`, slugs)}`));
    const bySlug = new Map(rows.map((r) => [String(r.slug), String(r.name ?? '')]));
    return slugs.map((s) => bySlug.get(s) ?? '').filter(Boolean);
  }

  private async recentlyViewed(profileId: string): Promise<string[]> {
    const rows = rowsOf(await db.execute(sql`
      select p.name, max(e.created_at) as at
      from recommendation_events e
      join products p on p.id = e.product_id
      where e.event_type = 'PRODUCT_VIEWED' and e.created_at > now() - interval '60 days'
        and e.profile_id in (
          select ${profileId}::uuid
          union
          select sib.id from experience_profiles me
          join experience_profiles sib on sib.customer_id = me.customer_id
          where me.id = ${profileId}::uuid and me.customer_id is not null
        )
      group by p.name
      order by at desc
      limit 3
    `));
    return rows.map((r) => String(r.name ?? '')).filter(Boolean);
  }

  private async pastTopics(key: AssistantShopperKey): Promise<string[]> {
    if (!key.fpClientId && !key.userId) return [];
    // Each identity reads its own partial index (0180) newest first; the two short lists are merged.
    const side = (cond: ReturnType<typeof sql>) => sql`(select ${payloadField('topic')} as topic, captured_at from zero_party_signals
      where source_component = ${GOLDIE_SOURCE_COMPONENT} and ${cond} and captured_at > now() - interval '120 days' order by captured_at desc limit 12)`;
    const parts = [key.fpClientId ? side(sql`fp_client_id = ${key.fpClientId}`) : null, key.userId ? side(sql`user_id = ${key.userId}::uuid`) : null].filter(Boolean) as ReturnType<typeof sql>[];
    const rows = rowsOf(await db.execute(sql`select topic from (${sql.join(parts, sql` union all `)}) t order by captured_at desc limit 12`));
    const seen = new Set<string>(); const out: string[] = [];
    for (const r of rows) {
      const t = String(r.topic ?? '').trim();
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase()); out.push(t);
      if (out.length >= 3) break;
    }
    return out;
  }

  /** A signed-in customer with no saved address yet: the name on their latest order. */
  private async accountFirstName(userId: string): Promise<string | null> {
    const rows = rowsOf(await db.execute(sql`
      select customer_name from orders where user_id = ${userId}::uuid and coalesce(customer_name, '') <> ''
      order by created_at desc limit 1
    `));
    const raw = String(rows[0]?.customer_name ?? '').trim();
    return raw ? raw.split(/\s+/)[0]! : null;
  }
}

/** "SARAH" or "sarah" reads as "Sarah"; anything that is not a plausible first name is dropped. */
export function tidyName(raw: string | null | undefined): string | null {
  const n = String(raw ?? '').trim();
  if (!n || n.length > 30 || !/^[\p{L}][\p{L}'-]*$/u.test(n)) return null;
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

type CaptureZeroParty = { execute(signal: ZeroPartySignal, ip?: string, ua?: string, sessionUserId?: string | null): Promise<{ captured: boolean }> };

/** Customer DNA: each topic a shopper raises with Goldie becomes a zero-party signal, through the consent-checked capture. */
export class ZeroPartyAssistantInterestSink implements IAssistantInterestSink {
  constructor(private readonly capture: CaptureZeroParty) {}

  async record(key: AssistantShopperKey, interest: AssistantInterest): Promise<boolean> {
    if (!key.fpClientId) return false;
    const out = await this.capture.execute({
      fp_client_id: key.fpClientId,
      signal_type: 'declared_intent',
      payload: { source: 'goldie', intent: interest.intent, topic: interest.topic, ...(interest.phoneModel ? { phone_model: interest.phoneModel } : {}) },
      ...(interest.page ? { page_location: interest.page } : {}),
      source_component: GOLDIE_SOURCE_COMPONENT,
    }, undefined, undefined, key.userId);
    return out.captured;
  }
}
