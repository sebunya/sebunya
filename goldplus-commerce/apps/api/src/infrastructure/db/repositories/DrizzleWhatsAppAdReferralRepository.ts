import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { StoredWhatsAppReferral, WhatsAppAdReferralRepository } from '../../../application/ports/WhatsAppAds';
import type { WhatsAppAdReferral } from '../../../domain/advertising/WhatsAppAdReferrals';

/** Click-to-WhatsApp advert referrals (0166). Raw SQL, like the other advertising tables. */
const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

export class DrizzleWhatsAppAdReferralRepository implements WhatsAppAdReferralRepository {
  async record(r: WhatsAppAdReferral): Promise<boolean> {
    const inserted = rowsOf(await db.execute(sql`
      insert into whatsapp_ad_referrals (message_id, waba_id, phone_number_id, sender_phone_sha256, ctwa_clid, source_type, source_id, source_url, headline, received_at)
      values (${r.messageId}, ${r.wabaId}, ${r.phoneNumberId}, ${r.senderPhoneSha256}, ${r.ctwaClid}, ${r.sourceType}, ${r.sourceId}, ${r.sourceUrl}, ${r.headline}, ${r.receivedAt.toISOString()}::timestamptz)
      on conflict (message_id) do nothing returning id`));
    return inserted.length > 0;
  }

  async latestFor(senderPhoneSha256: string, from: Date, to: Date): Promise<StoredWhatsAppReferral | null> {
    const r = rowsOf(await db.execute(sql`
      select id, ctwa_clid, waba_id, source_id, received_at from whatsapp_ad_referrals
      where sender_phone_sha256 = ${senderPhoneSha256} and received_at >= ${from.toISOString()}::timestamptz and received_at <= ${to.toISOString()}::timestamptz
      order by received_at desc limit 1`))[0];
    return r ? { id: String(r.id), ctwaClid: String(r.ctwa_clid), wabaId: String(r.waba_id), sourceId: r.source_id ?? null, receivedAt: new Date(r.received_at) } : null;
  }

  async markAttributed(id: string): Promise<void> {
    await db.execute(sql`update whatsapp_ad_referrals set attributed_count = attributed_count + 1, last_attributed_at = now() where id = ${id}::uuid`);
  }

  async stats(since: Date): Promise<{ received: number; attributed: number; lastReceivedAt: string | null; adverts: number }> {
    const r = rowsOf(await db.execute(sql`
      select count(*)::int as received, count(*) filter (where attributed_count > 0)::int as attributed,
             max(received_at) as last_received, count(distinct source_id)::int as adverts
      from whatsapp_ad_referrals where received_at >= ${since.toISOString()}::timestamptz`))[0] ?? {};
    return { received: Number(r.received ?? 0), attributed: Number(r.attributed ?? 0), lastReceivedAt: r.last_received ? new Date(r.last_received).toISOString() : null, adverts: Number(r.adverts ?? 0) };
  }
}
