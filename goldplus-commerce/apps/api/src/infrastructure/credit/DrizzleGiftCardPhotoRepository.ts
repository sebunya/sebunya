import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { IGiftCardPhotoRepository, ProcessedGiftCardPhoto } from '../../application/ports/IGiftCardPhotoRepository';

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, any>>;

/**
 * 0201: gift card photos (gift_card_photos, bytea). Claiming one for a purchase happens in the purchase's own
 * transaction (DrizzleGiftCardPurchaseRepository.create); everything after that is here.
 */
export class DrizzleGiftCardPhotoRepository implements IGiftCardPhotoRepository {
  async save(photo: ProcessedGiftCardPhoto, uploaderKey: string | null): Promise<string> {
    const [r] = rowsOf(await db.execute(sql`
      insert into gift_card_photos (image, width, height, uploader_key)
      values (${photo.image}, ${photo.width}, ${photo.height}, ${uploaderKey}) returning id`));
    return String(r.id);
  }

  async image(id: string, claimableAfter: Date): Promise<Buffer | null> {
    const [r] = rowsOf(await db.execute(sql`
      select image from gift_card_photos where id = ${id} and (attached_at is not null or created_at > ${claimableAfter})`));
    if (!r?.image) return null;
    // postgres-js hands bytea back as a Buffer already; copy only what is not one.
    return Buffer.isBuffer(r.image) ? r.image : Buffer.from(r.image);
  }

  async countSince(since: Date, uploaderKey?: string): Promise<number> {
    const [r] = rowsOf(await db.execute(sql`
      select count(*)::int as n from gift_card_photos
       where created_at > ${since} ${uploaderKey ? sql`and uploader_key = ${uploaderKey}` : sql``}`));
    return Number(r?.n ?? 0);
  }

  async deleteStale(cutoffs: Parameters<IGiftCardPhotoRepository['deleteStale']>[0]): Promise<number> {
    const unclaimed = rowsOf(await db.execute(sql`
      delete from gift_card_photos where attached_at is null and created_at < ${cutoffs.unclaimedBefore} returning id`)).length;
    // photo_id is ON DELETE SET NULL: the purchase keeps everything else.
    const ended = rowsOf(await db.execute(sql`
      delete from gift_card_photos where id in (
        select photo_id from gift_card_purchases
         where photo_id is not null and status in ('abandoned', 'failed', 'refunded') and updated_at < ${cutoffs.purchaseEndedBefore})
      returning id`)).length;
    // A card that can no longer be spent: cancelled, expired, or used up (the shop's own balance rule: every ledger row
    // except released holds) with its last movement before the cut-off.
    const done = rowsOf(await db.execute(sql`
      delete from gift_card_photos where id in (
        select p.photo_id from gift_card_purchases p join credit_instruments i on i.id = p.instrument_id
         where p.photo_id is not null and (
               (i.status = 'void' and coalesce(i.voided_at, i.created_at) < ${cutoffs.cardDoneBefore})
            or (i.expires_at is not null and i.expires_at < ${cutoffs.cardDoneBefore})
            or (coalesce((select sum(l.amount_ugx) from credit_ledger l
                           where l.instrument_id = i.id and not (l.type = 'HOLD' and l.hold_state = 'released')), 0) <= 0
                and (select max(l.created_at) from credit_ledger l where l.instrument_id = i.id) < ${cutoffs.cardDoneBefore})))
      returning id`)).length;
    return unclaimed + ended + done;
  }

  async removeFromPurchase(purchaseId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [p] = rowsOf(await tx.execute(sql`select photo_id from gift_card_purchases where id = ${purchaseId} for update`));
      if (!p?.photo_id) return false;
      await tx.execute(sql`update gift_card_purchases set photo_id = null, updated_at = now() where id = ${purchaseId}`);
      await tx.execute(sql`delete from gift_card_photos where id = ${p.photo_id}`);
      return true;
    });
  }

  async purchaseIdByReference(reference: string): Promise<string | null> {
    const [r] = rowsOf(await db.execute(sql`select id from gift_card_purchases where reference = ${reference} limit 1`));
    return r?.id ? String(r.id) : null;
  }

  async purchaseIdByCodeHash(codeHash: string): Promise<string | null> {
    const [r] = rowsOf(await db.execute(sql`
      select p.id from gift_card_purchases p join credit_instruments i on i.id = p.instrument_id where i.code_hash = ${codeHash} limit 1`));
    return r?.id ? String(r.id) : null;
  }
}
