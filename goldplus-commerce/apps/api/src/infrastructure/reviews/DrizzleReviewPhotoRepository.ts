import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { ProcessedGiftCardPhoto } from '../../application/ports/IGiftCardPhotoRepository';
import type { IReviewPhotoRepository } from '../../application/use-cases/reviews/ReviewPhotoUseCases';

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, any>>;

/** 0209: review photos (review_photos, bytea), the gift-card photo store's shape. */
export class DrizzleReviewPhotoRepository implements IReviewPhotoRepository {
  async save(photo: ProcessedGiftCardPhoto, uploaderKey: string | null): Promise<string> {
    const [r] = rowsOf(await db.execute(sql`insert into review_photos (image, width, height, uploader_key) values (${photo.image}, ${photo.width}, ${photo.height}, ${uploaderKey}) returning id`));
    return String(r.id);
  }

  async countSince(since: Date, uploaderKey?: string): Promise<number> {
    const [r] = rowsOf(await db.execute(sql`select count(*)::int as n from review_photos where created_at > ${since} ${uploaderKey ? sql`and uploader_key = ${uploaderKey}` : sql``}`));
    return Number(r?.n ?? 0);
  }

  async attach(reviewId: string, photoIds: string[], claimableAfter: Date, now: Date, max: number): Promise<number> {
    if (!photoIds.length || max < 1) return 0;
    const ids = sql.join(photoIds.map((id) => sql`${id}::uuid`), sql`, `);
    return rowsOf(await db.execute(sql`update review_photos set review_id = ${reviewId}::uuid, attached_at = ${now}
      where id in (select id from review_photos where id in (${ids}) and review_id is null and created_at > ${claimableAfter} order by created_at limit ${max})
      returning id`)).length;
  }

  async image(id: string, includeUnpublished: boolean): Promise<Buffer | null> {
    const [r] = rowsOf(await db.execute(sql`select p.image from review_photos p join reviews r on r.id = p.review_id
      where p.id = ${id}::uuid ${includeUnpublished ? sql`` : sql`and r.status = 'published'`}`));
    if (!r?.image) return null;
    return Buffer.isBuffer(r.image) ? r.image : Buffer.from(r.image);
  }

  async deleteUnattachedBefore(before: Date): Promise<number> {
    return rowsOf(await db.execute(sql`delete from review_photos where review_id is null and created_at < ${before} returning id`)).length;
  }
}
