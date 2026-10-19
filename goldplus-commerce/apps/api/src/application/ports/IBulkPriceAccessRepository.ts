import type { AccessChallenge } from '../../domain/quotes/BulkPriceAccess';

export interface IBulkPriceAccessRepository {
  /** Codes sent to this phone since a moment (verified or not). */
  countSince(phone: string, since: Date): Promise<number>;
  create(input: { phone: string; codeHash: string; expiresAt: Date }): Promise<void>;
  /** The newest unverified challenge for the phone, expired or not. */
  latestOpen(phone: string): Promise<AccessChallenge | null>;
  /** Adds one to attempts and returns the new count. */
  recordAttempt(id: string): Promise<number>;
  /** Compare-and-set: false when someone already verified it. */
  markVerified(id: string, at: Date): Promise<boolean>;
  /** Phones that proved themselves, newest first: the team's bulk leads. */
  listVerified(opts: { since: Date; limit: number }): Promise<Array<{ phone: string; verifiedAt: Date }>>;
}
