import { OtpChannel, OtpPurpose } from '../../domain/security/OtpChallenge';

export interface PersistedOtpChallenge {
  id: string;
  userId: string | null;
  purpose: OtpPurpose;
  channel: OtpChannel;
  destination: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface IOtpChallengeRepository {
  create(input: {
    userId: string | null;
    purpose: OtpPurpose;
    channel: OtpChannel;
    destination: string;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
  }): Promise<PersistedOtpChallenge>;
  findById(id: string): Promise<PersistedOtpChallenge | null>;
  incrementAttempts(id: string): Promise<void>;
  markConsumed(id: string): Promise<void>;
  /** Count of challenges created for a user/destination since a time — for rate limiting resends. */
  countRecent(opts: { userId?: string | null; destination?: string; since: Date }): Promise<number>;
}
