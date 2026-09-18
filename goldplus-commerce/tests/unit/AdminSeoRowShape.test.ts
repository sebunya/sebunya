import { describe, it, expect } from 'vitest';
import { withCamelAliases, rowsOf } from '../../apps/web/src/lib/adminSeo';

/**
 * The SEO admin pages read camelCase; most endpoints return raw snake_case
 * rows, and paged ones answer { rows, total }. Both made populated screens
 * render "—" / "No pages recorded" (2026-09-18).
 */
describe('admin SEO response shape', () => {
  it('adds camelCase aliases at any depth and keeps the original keys', () => {
    const out = withCamelAliases({ started_at: 't', pages_crawled: 128, nested: [{ http_status: 200 }] }) as any;
    expect(out.startedAt).toBe('t');
    expect(out.started_at).toBe('t');
    expect(out.pagesCrawled).toBe(128);
    expect(out.nested[0].httpStatus).toBe(200);
    expect(out.nested[0].statusCode).toBe(200);
  });

  it('never overwrites a camelCase key the API already sent', () => {
    expect((withCamelAliases({ startedAt: 'api', started_at: 'db' }) as any).startedAt).toBe('api');
  });

  it('reads { rows, total }, { items }, and bare arrays', () => {
    expect(rowsOf({ ok: true, data: { rows: [1, 2], total: 2 } })).toEqual([1, 2]);
    expect(rowsOf({ ok: true, data: { items: [3] } })).toEqual([3]);
    expect(rowsOf({ ok: true, data: [4] })).toEqual([4]);
    expect(rowsOf({ ok: false, message: 'x' })).toEqual([]);
  });
});
