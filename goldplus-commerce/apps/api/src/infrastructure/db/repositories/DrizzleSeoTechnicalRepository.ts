import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { WebVitalMeasurement } from '../../../application/use-cases/seo-growth/WebVitalsUseCases';

/**
 * Technical SEO governance data access (migration 0120) — robots.txt versions
 * and Core Web Vitals measurements.
 *
 * Raw SQL via db.execute with the rowsOf guard, matching the sibling SEO
 * repositories.
 *
 * Two invariants are enforced here rather than assumed:
 *  * Exactly one PUBLISHED robots version exists. A partial unique index backs
 *    it; publish() supersedes the incumbent in the SAME transaction so the
 *    index is never transiently violated.
 *  * Version numbers are allocated from max(version)+1 inside the insert, so
 *    two concurrent drafts cannot collide on the unique index.
 */

const rowsOf = (result: unknown): any[] => (Array.isArray(result) ? result : (result as any)?.rows ?? []);

export class DrizzleSeoTechnicalRepository {
  // ── robots.txt versions ───────────────────────────────────────────────────

  async listRobotsVersions(limit = 50): Promise<any[]> {
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return rowsOf(await db.execute(sql`
      select v.*, r.version as restored_from_version
      from seo_robots_versions v
      left join seo_robots_versions r on r.id = v.restored_from_id
      order by v.version desc
      limit ${capped}
    `));
  }

  async getRobotsVersion(id: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`select * from seo_robots_versions where id = ${id}`));
    return rows[0] ?? null;
  }

  /** The single live version, or null when nothing has ever been published. */
  async getPublishedRobots(): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`
      select * from seo_robots_versions where status = 'PUBLISHED' limit 1
    `));
    return rows[0] ?? null;
  }

  /**
   * A new DRAFT. The version number is allocated in-statement from the current
   * maximum so concurrent authors serialise on the unique index rather than on
   * a read-then-write race.
   */
  async createRobotsDraft(input: {
    content: string;
    note?: string | null;
    restoredFromId?: string | null;
    createdBy: string;
  }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_robots_versions (version, content, status, note, created_by, restored_from_id)
      select coalesce(max(version), 0) + 1, ${input.content}, 'DRAFT', ${input.note ?? null},
             ${input.createdBy}, ${input.restoredFromId ?? null}
      from seo_robots_versions
      returning *
    `));
    return rows[0];
  }

  /** DRAFT -> PENDING_APPROVAL. Only a draft may be submitted. */
  async submitRobotsVersion(id: string, note: string | null): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`
      update seo_robots_versions
      set status = 'PENDING_APPROVAL',
          note = coalesce(${note}, note)
      where id = ${id} and status = 'DRAFT'
      returning *
    `));
    return rows[0] ?? null;
  }

  /**
   * PENDING_APPROVAL -> APPROVED. The approver identity is recorded, never a
   * bare flag; the separation-of-duties check runs in the use case before this
   * is called, and the `created_by <> approver` guard repeats it in SQL so a
   * future caller cannot bypass it.
   */
  async approveRobotsVersion(id: string, approverId: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`
      update seo_robots_versions
      set status = 'APPROVED', approved_by = ${approverId}, approved_at = now()
      where id = ${id} and status = 'PENDING_APPROVAL' and created_by <> ${approverId}
      returning *
    `));
    return rows[0] ?? null;
  }

  async rejectRobotsVersion(id: string, actorId: string, note: string | null): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`
      update seo_robots_versions
      -- approved_by/approved_at are deliberately NOT written here. Recording
      -- the rejecter as the approver made a REJECTED version render as
      -- "approved by X" for someone who never approved anything.
      set status = 'REJECTED',
          note = coalesce(${note}, note)
      where id = ${id} and status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')
      returning *
    `));
    return rows[0] ?? null;
  }

  /**
   * APPROVED -> PUBLISHED, superseding the incumbent atomically. Both updates
   * run in one transaction so the partial unique index on
   * (status = 'PUBLISHED') never sees two live rows.
   */
  async publishRobotsVersion(id: string): Promise<{ published: any | null; superseded: any | null }> {
    return db.transaction(async (tx: any) => {
      const target = rowsOf(await tx.execute(sql`
        select * from seo_robots_versions where id = ${id} for update
      `))[0];
      if (!target || target.status !== 'APPROVED') return { published: null, superseded: null };

      const superseded = rowsOf(await tx.execute(sql`
        update seo_robots_versions
        set status = 'SUPERSEDED', superseded_at = now()
        where status = 'PUBLISHED'
        returning *
      `))[0] ?? null;

      const published = rowsOf(await tx.execute(sql`
        update seo_robots_versions
        set status = 'PUBLISHED', published_at = now()
        where id = ${id}
        returning *
      `))[0] ?? null;

      return { published, superseded };
    });
  }

  // ── Core Web Vitals ───────────────────────────────────────────────────────

  /**
   * One row per (url, source, form_factor, collection_date). Re-syncing the
   * same day refreshes that day's reading rather than inflating history.
   * performance_score is passed through as given — the CHECK rejects a score
   * on a CRUX_FIELD row, and the use case never supplies one.
   */
  async upsertWebVital(m: WebVitalMeasurement): Promise<any> {
    const distributions = m.distributions ?? null;
    const raw = m.raw ?? null;
    const rows = rowsOf(await db.execute(sql`
      insert into seo_web_vitals
        (url, source, form_factor, collection_date, lcp_ms, inp_ms, cls, ttfb_ms, fcp_ms,
         performance_score, distributions, sample_size, connection_id, raw)
      values
        (${m.url}, ${m.source}, ${m.formFactor}, ${m.collectionDate},
         ${m.lcpMs ?? null}, ${m.inpMs ?? null}, ${m.cls ?? null}, ${m.ttfbMs ?? null}, ${m.fcpMs ?? null},
         ${m.performanceScore ?? null},
         ${distributions === null ? null : (distributions as never)}::jsonb,
         ${m.sampleSize ?? null}, ${m.connectionId ?? null},
         ${raw === null ? null : (raw as never)}::jsonb)
      on conflict (url, source, form_factor, collection_date) do update set
        collected_at = now(),
        lcp_ms = excluded.lcp_ms,
        inp_ms = excluded.inp_ms,
        cls = excluded.cls,
        ttfb_ms = excluded.ttfb_ms,
        fcp_ms = excluded.fcp_ms,
        performance_score = excluded.performance_score,
        distributions = excluded.distributions,
        sample_size = excluded.sample_size,
        connection_id = excluded.connection_id,
        raw = excluded.raw
      returning *
    `));
    return rows[0];
  }

  /**
   * The most recent measurement per (url, source, form_factor). Lab and field
   * rows come back side by side but never merged — the caller keeps them apart.
   */
  async latestWebVitals(filter: { url?: string; limit?: number } = {}): Promise<any[]> {
    const limit = Math.min(Math.max(Number(filter.limit) || 200, 1), 500);
    const url = filter.url ?? null;
    return rowsOf(await db.execute(sql`
      select distinct on (url, source, form_factor) *
      from seo_web_vitals
      where (${url}::text is null or url = ${url})
      order by url, source, form_factor, collected_at desc
      limit ${limit}
    `));
  }

  /** Every reading for one URL, newest first — the trend, not a summary. */
  async webVitalsHistory(url: string, limit = 100): Promise<any[]> {
    const capped = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return rowsOf(await db.execute(sql`
      select * from seo_web_vitals
      where url = ${url}
      order by collected_at desc
      limit ${capped}
    `));
  }

  /** Distinct URLs that have ever been measured. Absence here is NOT_MEASURED. */
  async measuredUrls(): Promise<string[]> {
    const rows = rowsOf(await db.execute(sql`select distinct url from seo_web_vitals order by url`));
    return rows.map((r) => String(r.url));
  }
}
