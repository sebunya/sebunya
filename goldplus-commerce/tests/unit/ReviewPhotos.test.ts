import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REVIEW_PHOTOS_PER_REVIEW, REVIEW_PHOTOS_PER_VISITOR_PER_DAY, ReviewPhotoUseCases, type IReviewPhotoRepository } from '../../apps/api/src/application/use-cases/reviews/ReviewPhotoUseCases';
import { SubmitOrderReviewUseCase, type VerifiedOrder } from '../../apps/api/src/application/use-cases/reviews/OrderReviewUseCases';
import { SubmitReviewUseCase } from '../../apps/api/src/application/use-cases/reviews/SubmitReviewUseCase';
import type { IReviewRepository } from '../../apps/api/src/application/ports/IReviewRepository';

/**
 * Photos on reviews (0209, gap analysis #10): the gift-card pipeline and ceilings, upload then attach (at most three,
 * only unattached and recent), shown only when published, a refused attach never loses the review.
 */
const P1 = '11111111-1111-4111-8111-111111111111';
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'];
const NOW = new Date('2026-10-25T12:00:00Z');

function fakePhotoRepo() {
  const photos: Array<{ id: string; reviewId: string | null; uploaderKey: string | null; createdAt: Date; published: boolean; rejectedAt?: Date }> = [];
  const repo: IReviewPhotoRepository = {
    async save(_p, uploaderKey) { const id = ids[photos.length] ?? `bbbbbbbb-bbbb-4bbb-8bbb-${String(photos.length).padStart(12, '0')}`; photos.push({ id, reviewId: null, uploaderKey, createdAt: NOW, published: false }); return id; },
    async countSince(since, uploaderKey) { return photos.filter((p) => p.createdAt > since && (!uploaderKey || p.uploaderKey === uploaderKey)).length; },
    async attach(reviewId, photoIds, claimableAfter, now, max) { let n = 0; for (const p of photos) if (n < max && photoIds.includes(p.id) && !p.reviewId && p.createdAt > claimableAfter) { p.reviewId = reviewId; n++; void now; } return n; },
    async image(id, includeUnpublished) { const p = photos.find((x) => x.id === id && x.reviewId); return p && (p.published || includeUnpublished) ? Buffer.from('jpeg') : null; },
    async deleteUnattachedBefore(before) { const n = photos.filter((p) => !p.reviewId && p.createdAt < before).length; for (let i = photos.length - 1; i >= 0; i--) if (!photos[i].reviewId && photos[i].createdAt < before) photos.splice(i, 1); return n; },
    async deleteOfRejectedBefore(before) { let n = 0; for (let i = photos.length - 1; i >= 0; i--) if (photos[i].rejectedAt && photos[i].rejectedAt! < before) { photos.splice(i, 1); n++; } return n; },
  };
  return { repo, photos };
}
const processor = { process: async (b: Buffer) => (b.length < 10 ? { ok: false as const, reason: 'not_an_image' as const } : { ok: true as const, image: b, width: 600, height: 600 }) };

describe('review photos', () => {
  it('uploads through the processor with the visitor ceiling, attaches at most three unattached recent uploads, and serves only published', async () => {
    const { repo, photos } = fakePhotoRepo();
    const uc = new ReviewPhotoUseCases(repo, processor, (raw) => `k:${raw}`);
    expect(await uc.upload(Buffer.alloc(0), 'v1', NOW)).toMatchObject({ ok: false, reason: 'empty' });
    expect(await uc.upload(Buffer.from('tiny'), 'v1', NOW)).toMatchObject({ ok: false, reason: 'not_an_image' });
    for (let i = 0; i < 4; i++) expect(await uc.upload(Buffer.from('a real photo file'), 'v1', NOW)).toMatchObject({ ok: true, photoId: ids[i] });
    expect(photos.every((p) => p.uploaderKey === 'k:v1')).toBe(true);
    expect(await uc.attach('rev-1', [...ids, 'nope', ids[0]], NOW)).toBe(REVIEW_PHOTOS_PER_REVIEW);
    expect(photos.filter((p) => p.reviewId === 'rev-1').map((p) => p.id)).toEqual(ids.slice(0, 3));
    expect(await uc.attach('rev-2', ids, NOW)).toBe(1); // only the fourth was still free
    expect(await uc.image(ids[0])).toBeNull(); // review not published
    expect(await uc.image(ids[0], true)).not.toBeNull(); // the moderator sees it
    photos[0].published = true;
    expect(await uc.image(ids[0])).not.toBeNull();
    expect(await uc.image('nope')).toBeNull();
  });

  it('a visitor gets a dozen uploads a day, the shop a few hundred; without the native processor every upload says unavailable', async () => {
    const { repo } = fakePhotoRepo();
    const uc = new ReviewPhotoUseCases(repo, processor, (raw) => raw);
    for (let i = 0; i < REVIEW_PHOTOS_PER_VISITOR_PER_DAY; i++) expect((await uc.upload(Buffer.from('a real photo file'), 'v1', NOW)).ok).toBe(true);
    expect(await uc.upload(Buffer.from('a real photo file'), 'v1', NOW)).toMatchObject({ ok: false, reason: 'visitor_daily_limit' });
    expect((await uc.upload(Buffer.from('a real photo file'), 'v2', NOW)).ok).toBe(true);
    expect(await new ReviewPhotoUseCases(repo, null, (raw) => raw).upload(Buffer.from('a real photo file'), 'v3', NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('the sweep deletes only unattached uploads older than the claim window', async () => {
    const { repo, photos } = fakePhotoRepo();
    const uc = new ReviewPhotoUseCases(repo, processor, (raw) => raw);
    await uc.upload(Buffer.from('a real photo file'), 'v1', NOW); await uc.upload(Buffer.from('a real photo file'), 'v1', NOW);
    await uc.attach('rev-1', [ids[0]], NOW);
    expect(await uc.sweep(new Date(NOW.getTime() + 3 * 86_400_000))).toBe(1);
    expect(photos.map((p) => p.id)).toEqual([ids[0]]);
  });

  it('a rejected review keeps its photos for 30 days (moderation can be reversed), then they go', async () => {
    const { repo, photos } = fakePhotoRepo();
    const seen: string[] = [];
    const uc = new ReviewPhotoUseCases(repo, processor, (raw) => raw, (e) => { seen.push(e); });
    await uc.upload(Buffer.from('a real photo file'), 'v1', NOW);
    await uc.attach('rev-1', [ids[0]], NOW);
    photos[0].rejectedAt = NOW;
    expect(await uc.sweep(new Date(NOW.getTime() + 29 * 86_400_000))).toBe(0);
    expect(await uc.sweep(new Date(NOW.getTime() + 31 * 86_400_000))).toBe(1);
    expect(photos).toHaveLength(0);
  });

  it('review photos keep their whole frame; served for an hour, outside the page middleware, swept on their own', () => {
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
    expect(read('apps/api/src/application/use-cases/reviews/ReviewPhotoUseCases.ts')).toContain('this.processor.process(bytes, { whole: true })');
    expect(read('apps/web/src/pages/review-photo/[id].ts')).toContain("'Cache-Control': 'public, max-age=3600'");
    expect(read('apps/web/src/middleware.ts')).toContain('!path.startsWith("/review-photo/") && !path.startsWith("/admin/review-photo/")');
    const ticker = read('apps/api/src/infrastructure/scheduler/PaymentReconcileTicker.ts');
    expect(ticker).toMatch(/try \{[^}]*reviewPhotoUseCases\.sweep\(new Date\(\)\);\s*\} catch \(error\) \{\s*logger\.error\(\{ err: error \}, '\[review-photo\] sweep failed'\)/);
  });

  it('the review submission attaches the photos it was given and still succeeds when attaching fails', async () => {
    const inserted: any[] = [];
    const reviews = {
      async resolveOrderLine() { return { orderPhone: '+256700123456', orderStatus: 'delivered' }; },
      async insertReview(i: any) { inserted.push(i); return { id: 'rev-9' }; },
      async findOrderLineId() { return 'line-1'; },
    } as unknown as IReviewRepository;
    const order: VerifiedOrder = { orderNumber: 'GP-1', customerPhone: '+256700123456', orderStatus: 'delivered', items: [{ productId: P1, name: 'Battery' }] };
    const attached: any[] = [];
    const ok = new SubmitOrderReviewUseCase(reviews, new SubmitReviewUseCase(reviews, 'pepper'), async (reviewId, photoIds) => { attached.push([reviewId, photoIds]); return 2; });
    expect(await ok.execute(order, { productId: P1, rating: 5, body: 'Fits', photoIds: [ids[0], ids[1]] })).toMatchObject({ ok: true, photos: 2 });
    expect(attached).toEqual([['rev-9', [ids[0], ids[1]]]]);
    const failing = new SubmitOrderReviewUseCase(reviews, new SubmitReviewUseCase(reviews, 'pepper'), async () => { throw new Error('db'); });
    expect(await failing.execute(order, { productId: P1, rating: 4, photoIds: [ids[0]] })).toMatchObject({ ok: true, photos: 0 });
    expect(await failing.execute(order, { productId: P1, rating: 4 })).toMatchObject({ ok: true, photos: 0 });
  });
});

describe('migration 0209', () => {
  const dir = path.resolve(__dirname, '../../apps/api/src/infrastructure/db/migrations');
  it('is journalled right after 0208 and is additive only', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
    const i = journal.entries.findIndex((e) => e.tag === '0209_review_photos');
    expect(journal.entries[i - 1].tag).toBe('0208_product_questions');
    expect(journal.entries[i].idx).toBe(208);
    const sql = fs.readFileSync(path.join(dir, '0209_review_photos.sql'), 'utf8');
    for (const st of sql.split('--> statement-breakpoint').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) expect(st).toMatch(/^CREATE (TABLE|INDEX) IF NOT EXISTS/);
  });
});
