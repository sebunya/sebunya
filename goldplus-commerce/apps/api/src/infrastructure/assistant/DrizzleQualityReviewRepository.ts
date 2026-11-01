import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { assistantQaReviews } from '../db/schema/assistant';
import type { IQualityReviewRepository, QaRow } from '../../application/use-cases/assistant/QualityReviewUseCases';

const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;

export class DrizzleQualityReviewRepository implements IQualityReviewRepository {
  async sample(week: string, from: Date, to: Date, size: number) {
    // Half from the chats most worth a look (needed a person, rated 1-2, or used the model), half at random.
    const r = rowsOf(await db.execute(sql`
      with pool as (
        select id, (outcome in ('needs_human', 'handed_over') or coalesce(csat, 5) <= 2 or ai_turns > 0) as flagged
        from assistant_conversations where last_message_at >= ${from} and last_message_at < ${to} and message_count >= 2
      ), picked as (
        (select id from pool where flagged order by random() limit ${Math.ceil(size / 2)})
        union
        (select id from pool order by random() limit ${size})
      )
      insert into assistant_qa_reviews (conversation_id, week)
      select id, ${week} from picked limit ${size}
      on conflict (conversation_id, week) do nothing
      returning id`));
    return r.length;
  }

  async list(week: string): Promise<QaRow[]> {
    const r = rowsOf(await db.execute(sql`
      select q.id, q.conversation_id, q.week, q.score, q.accurate, q.tone_ok, q.note, q.reviewed_at, c.channel, c.outcome, c.csat, c.last_message_at,
        coalesce((select m.content from assistant_messages m where m.conversation_id = c.id and m.role = 'customer' order by m.created_at limit 1), '') as first_line
      from assistant_qa_reviews q join assistant_conversations c on c.id = q.conversation_id
      where q.week = ${week} order by q.reviewed_at nulls first, c.last_message_at desc`));
    return r.map((x) => ({
      id: String(x.id), conversationId: String(x.conversation_id), week: String(x.week), score: x.score == null ? null : Number(x.score),
      accurate: x.accurate == null ? null : Boolean(x.accurate), toneOk: x.tone_ok == null ? null : Boolean(x.tone_ok), note: x.note ? String(x.note) : null,
      reviewedAt: x.reviewed_at ? new Date(String(x.reviewed_at)) : null, channel: String(x.channel), outcome: String(x.outcome), csat: x.csat == null ? null : Number(x.csat),
      firstLine: String(x.first_line).slice(0, 200), lastMessageAt: new Date(String(x.last_message_at)),
    }));
  }

  async review(id: string, i: { score: number; accurate: boolean; toneOk: boolean; note: string | null; reviewerId: string }) {
    const r = await db.update(assistantQaReviews).set({ score: i.score, accurate: i.accurate, toneOk: i.toneOk, note: i.note, reviewerId: /^[0-9a-f-]{36}$/i.test(i.reviewerId) ? i.reviewerId : null, reviewedAt: sql`now()` })
      .where(eq(assistantQaReviews.id, id)).returning({ id: assistantQaReviews.id });
    return r.length > 0;
  }

  async trend(weeks: number) {
    const r = rowsOf(await db.execute(sql`
      select week, count(*) filter (where reviewed_at is not null)::int as reviewed, avg(score)::float8 as avg_score,
        avg(case when accurate then 1.0 when accurate = false then 0.0 end)::float8 as accurate_share,
        avg(case when tone_ok then 1.0 when tone_ok = false then 0.0 end)::float8 as tone_share
      from assistant_qa_reviews group by week order by week desc limit ${weeks}`));
    return r.map((x) => ({ week: String(x.week), reviewed: Number(x.reviewed), averageScore: x.avg_score == null ? null : Number(x.avg_score), accurateShare: x.accurate_share == null ? null : Number(x.accurate_share), toneShare: x.tone_share == null ? null : Number(x.tone_share) }));
  }
}
