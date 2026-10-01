import type { WhatsAppAdReferral } from '../../domain/advertising/WhatsAppAdReferrals';

export interface StoredWhatsAppReferral { id: string; ctwaClid: string; wabaId: string; sourceId: string | null; receivedAt: Date }

/** Click-to-WhatsApp advert referrals: hashed sender, click id, advert. No message, no number. */
export interface WhatsAppAdReferralRepository {
  /** Stores one referral; false when this message was already recorded (Meta retries deliveries). */
  record(referral: WhatsAppAdReferral): Promise<boolean>;
  /** The most recent referral from this sender inside [from, to], or null. */
  latestFor(senderPhoneSha256: string, from: Date, to: Date): Promise<StoredWhatsAppReferral | null>;
  /** Notes that a sale was reported to Meta against this referral. */
  markAttributed(id: string): Promise<void>;
  stats(since: Date): Promise<{ received: number; attributed: number; lastReceivedAt: string | null; adverts: number }>;
  /** Removes referrals received before the given time; returns how many. */
  purgeBefore(cutoff: Date): Promise<number>;
}
