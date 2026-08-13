import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { RenderDiffRecord } from '../../../application/use-cases/seo-growth/RenderDiffUseCases';
import type { CrawlerHitCandidate, LogFormat } from '../../../application/use-cases/seo-growth/ServerLogSeoUseCases';

/**
 * SEO observability data access (migration 0120): raw-vs-rendered diffs,
 * server-log crawler hits and log ingestion runs.
 *
 * Raw SQL via db.execute with the rowsOf guard, matching the sibling SEO
 * repositories. Nothing from a log file is ever interpolated as SQL — every
 * value is a bound parameter.
 */

const rowsOf = (result: unknown): any[] => (Array.isArray(result) ? result : (result as any)?.rows ?? []);

/** Bound so a single ingestion cannot write an unbounded number of rows. */
const MAX_HIT_INSERT = 20_000;
const HIT_CHUNK = 500;

export class DrizzleSeoObservabilityRepository {
  // ── Raw vs rendered diffs ─────────────────────────────────────────────────

  /**
   * Persist a diff. severity is written exactly as the use case decided it —
   * the DB CHECK also refuses any severity other than UNKNOWN when
   * render_state is not RENDERED, so an unrendered page can never be stored as
   * "no difference found".
   */
  async saveRenderDiff(record: RenderDiffRecord): Promise<any> {
    const raw = record.raw;
    const rendered = record.rendered;
    const rows = rowsOf(await db.execute(sql`
      insert into seo_render_diffs
        (url, render_state, raw_status,
         raw_title, raw_meta_description, raw_h1, raw_word_count, raw_link_count,
         raw_canonical, raw_meta_robots, raw_jsonld_count,
         rendered_title, rendered_meta_description, rendered_h1, rendered_word_count, rendered_link_count,
         rendered_canonical, rendered_meta_robots, rendered_jsonld_count,
         differences, severity, error)
      values
        (${record.url}, ${record.renderState}, ${record.rawStatus ?? null},
         ${raw?.title ?? null}, ${raw?.metaDescription ?? null}, ${raw?.h1 ?? null},
         ${raw?.wordCount ?? null}, ${raw?.linkCount ?? null},
         ${raw?.canonical ?? null}, ${raw?.metaRobots ?? null}, ${raw?.jsonLdCount ?? null},
         ${rendered?.title ?? null}, ${rendered?.metaDescription ?? null}, ${rendered?.h1 ?? null},
         ${rendered?.wordCount ?? null}, ${rendered?.linkCount ?? null},
         ${rendered?.canonical ?? null}, ${rendered?.metaRobots ?? null}, ${rendered?.jsonLdCount ?? null},
         ${JSON.stringify(record.differences ?? [])}::text::jsonb,
         ${record.severity}, ${record.error ?? null})
      returning *
    `));
    return rows[0];
  }

  async listRenderDiffs(filter: { url?: string; severity?: string; limit?: number } = {}): Promise<any[]> {
    const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 500);
    return rowsOf(await db.execute(sql`
      select *
      from seo_render_diffs
      where (${filter.url ?? null}::text is null or url = ${filter.url ?? null})
        and (${filter.severity ?? null}::text is null or severity = ${filter.severity ?? null})
      order by observed_at desc
      limit ${limit}
    `));
  }

  /** Counts by render_state and severity, so the UI can show how much was never rendered. */
  async renderDiffSummary(): Promise<{ byState: any[]; bySeverity: any[]; total: number }> {
    const byState = rowsOf(await db.execute(sql`
      select render_state, count(*)::int as hits from seo_render_diffs group by render_state order by hits desc
    `));
    const bySeverity = rowsOf(await db.execute(sql`
      select severity, count(*)::int as hits from seo_render_diffs group by severity order by hits desc
    `));
    const total = byState.reduce((acc, r) => acc + Number(r.hits ?? 0), 0);
    return { byState, bySeverity, total };
  }

  // ── Crawler hits ──────────────────────────────────────────────────────────

  /**
   * Insert verified/unverified crawler hits in bounded chunks. `verification`
   * is whatever the verifier decided; this layer never upgrades it.
   */
  async insertCrawlerHits(hits: CrawlerHitCandidate[], sourceFile: string): Promise<number> {
    const capped = (hits ?? []).slice(0, MAX_HIT_INSERT);
    let inserted = 0;
    for (let i = 0; i < capped.length; i += HIT_CHUNK) {
      const chunk = capped.slice(i, i + HIT_CHUNK);
      const values = chunk.map((h) => sql`(
        ${h.hitAt.toISOString()}::timestamptz,
        (${h.hitAt.toISOString()}::timestamptz)::date,
        ${h.path}, ${h.crawler}, ${h.verification},
        ${h.statusCode ?? null}, ${h.bytes ?? null}, ${null},
        ${h.userAgent ?? null}, ${sourceFile}
      )`);
      const rows = rowsOf(await db.execute(sql`
        insert into seo_crawler_hits
          (hit_at, hit_date, path, crawler, verification, status_code, bytes, response_ms, user_agent, source_file)
        values ${sql.join(values, sql`, `)}
        returning id
      `));
      inserted += rows.length;
    }
    return inserted;
  }

  async listCrawlerHits(filter: { crawler?: string; verification?: string; days?: number; limit?: number } = {}): Promise<any[]> {
    const limit = Math.min(Math.max(Number(filter.limit) || 200, 1), 1000);
    const days = Math.min(Math.max(Number(filter.days) || 30, 1), 365);
    return rowsOf(await db.execute(sql`
      select *
      from seo_crawler_hits
      where hit_date >= (current_date - ${days}::int)
        and (${filter.crawler ?? null}::text is null or crawler = ${filter.crawler ?? null})
        and (${filter.verification ?? null}::text is null or verification = ${filter.verification ?? null})
      order by hit_at desc
      limit ${limit}
    `));
  }

  /**
   * Crawl-budget facts actually observed in the window. The verification split
   * is returned alongside every total so the UI can never present unverified
   * hits as confirmed crawler activity.
   */
  async crawlBudget(days = 30): Promise<{
    window: { days: number; firstHitAt: string | null; lastHitAt: string | null };
    perCrawler: any[];
    perPath: any[];
    perStatus: any[];
    verificationSplit: any[];
  }> {
    const d = Math.min(Math.max(Number(days) || 30, 1), 365);
    const [perCrawler, perPath, perStatus, verificationSplit, bounds] = await Promise.all([
      db.execute(sql`
        select crawler,
               count(*)::int as hits,
               count(*) filter (where verification = 'VERIFIED')::int as verified,
               count(*) filter (where verification = 'SPOOFED')::int as spoofed,
               count(*) filter (where verification = 'UNVERIFIED')::int as unverified,
               count(*) filter (where verification = 'NOT_CHECKED')::int as not_checked
        from seo_crawler_hits
        where hit_date >= (current_date - ${d}::int)
        group by crawler order by hits desc
      `),
      db.execute(sql`
        select path,
               count(*)::int as hits,
               count(*) filter (where verification = 'VERIFIED')::int as verified
        from seo_crawler_hits
        where hit_date >= (current_date - ${d}::int)
        group by path order by hits desc limit 50
      `),
      db.execute(sql`
        select coalesce(status_code, 0) as status_code, count(*)::int as hits
        from seo_crawler_hits
        where hit_date >= (current_date - ${d}::int)
        group by status_code order by hits desc
      `),
      db.execute(sql`
        select verification, count(*)::int as hits
        from seo_crawler_hits
        where hit_date >= (current_date - ${d}::int)
        group by verification order by hits desc
      `),
      db.execute(sql`
        select min(hit_at) as first_hit_at, max(hit_at) as last_hit_at
        from seo_crawler_hits
        where hit_date >= (current_date - ${d}::int)
      `),
    ]);
    const b = rowsOf(bounds)[0] ?? {};
    return {
      window: {
        days: d,
        firstHitAt: b.first_hit_at ? new Date(b.first_hit_at).toISOString() : null,
        lastHitAt: b.last_hit_at ? new Date(b.last_hit_at).toISOString() : null,
      },
      perCrawler: rowsOf(perCrawler),
      perPath: rowsOf(perPath),
      perStatus: rowsOf(perStatus),
      verificationSplit: rowsOf(verificationSplit),
    };
  }

  // ── Log ingestions ────────────────────────────────────────────────────────

  async recordLogIngestion(input: {
    sourceName: string;
    format: LogFormat;
    linesRead: number;
    linesParsed: number;
    linesRejected: number;
    crawlerHits: number;
    windowStart: Date | null;
    windowEnd: Date | null;
    createdBy: string;
  }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_log_ingestions
        (source_name, format, lines_read, lines_parsed, lines_rejected, crawler_hits,
         window_start, window_end, created_by)
      values
        (${input.sourceName}, ${input.format}, ${input.linesRead}, ${input.linesParsed},
         ${input.linesRejected}, ${input.crawlerHits},
         ${input.windowStart ? input.windowStart.toISOString() : null}::timestamptz,
         ${input.windowEnd ? input.windowEnd.toISOString() : null}::timestamptz,
         ${input.createdBy})
      returning *
    `));
    return rows[0];
  }

  async listLogIngestions(limit = 50): Promise<any[]> {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return rowsOf(await db.execute(sql`
      select * from seo_log_ingestions order by created_at desc limit ${n}
    `));
  }
}
