import { IOtpChallengeRepository } from '../../ports/IOtpChallengeRepository';
import { ITwoFactorRepository, BackupCodeEntry } from '../../ports/ITwoFactorRepository';
import { INotificationProvider } from '../../ports/INotificationProvider';
import { IOtpHasher } from './TwoFactorUseCases';
import {
  generateOtpCode,
  otpExpiryFrom,
  maskDestination,
  evaluateOtp,
  OtpChannel,
  OtpPurpose,
  OTP_MAX_ATTEMPTS,
} from '../../../domain/security/OtpChallenge';
import { generateBackupCodes, normalizeBackupCode } from '../../../domain/security/BackupCodes';

const RESEND_WINDOW_SECONDS = 60;
const MAX_SENDS_PER_WINDOW = 3;

export type StartOtpResult =
  | { ok: true; challengeId: string; destinationMasked: string; expiresAt: string; delivery: 'SENT' | 'NOT_CONFIGURED' | 'FAILED' }
  | { ok: false; code: 'THROTTLED' | 'BAD_DESTINATION'; message: string };

/**
 * Creates and delivers a one-time code over SMS or email. The code is
 * hashed before storage; resends are rate-limited to blunt SMS-pumping /
 * flooding abuse.
 */
export class StartOtpChallengeUseCase {
  constructor(
    private readonly otpRepo: IOtpChallengeRepository,
    private readonly hasher: IOtpHasher,
    private readonly smsProvider: INotificationProvider,
    private readonly emailProvider: INotificationProvider
  ) {}

  async execute(input: {
    userId: string | null;
    channel: OtpChannel;
    destination: string;
    purpose: OtpPurpose;
  }): Promise<StartOtpResult> {
    const destination = (input.destination || '').trim();
    const valid = input.channel === 'email' ? destination.includes('@') : /^\+?[0-9]{9,15}$/.test(destination.replace(/\s+/g, ''));
    if (!valid) return { ok: false, code: 'BAD_DESTINATION', message: 'A valid destination is required.' };

    const since = new Date(Date.now() - RESEND_WINDOW_SECONDS * 1000);
    const recent = await this.otpRepo.countRecent({ userId: input.userId, destination, since });
    if (recent >= MAX_SENDS_PER_WINDOW) {
      return { ok: false, code: 'THROTTLED', message: 'Too many codes requested. Please wait a minute and try again.' };
    }

    const code = generateOtpCode();
    const expiresAt = otpExpiryFrom();
    const codeHash = this.hasher.hash(code, destination);
    const challenge = await this.otpRepo.create({
      userId: input.userId,
      purpose: input.purpose,
      channel: input.channel,
      destination,
      codeHash,
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt,
    });

    const message = `Your GoldPlus verification code is ${code}. It expires in 5 minutes. Never share it with anyone.`;
    const provider = input.channel === 'sms' ? this.smsProvider : this.emailProvider;
    const dispatch = await provider.dispatch({
      recipient: destination,
      template: 'OTP',
      data: { message, otp: code },
      relatedEntity: 'otp_challenge',
      relatedEntityId: challenge.id,
    });

    const delivery = dispatch.status === 'SENT' ? 'SENT' : dispatch.status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'FAILED';
    return {
      ok: true,
      challengeId: challenge.id,
      destinationMasked: maskDestination(input.channel, destination),
      expiresAt: expiresAt.toISOString(),
      delivery,
    };
  }
}

export type VerifyOtpResult =
  | { ok: true; userId: string | null; purpose: OtpPurpose; channel: OtpChannel; destination: string }
  | { ok: false; code: 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' | 'TOO_MANY_ATTEMPTS' | 'INVALID_CODE'; message: string };

/** Verifies and consumes an OTP challenge. Wrong guesses increment the
 *  attempt counter until the challenge locks. */
export class VerifyOtpChallengeUseCase {
  constructor(private readonly otpRepo: IOtpChallengeRepository, private readonly hasher: IOtpHasher) {}

  async execute(input: { challengeId: string; code: string }): Promise<VerifyOtpResult> {
    const challenge = await this.otpRepo.findById(input.challengeId);
    if (!challenge) return { ok: false, code: 'NOT_FOUND', message: 'Challenge not found. Request a new code.' };

    const isMatch = this.hasher.matches((input.code ?? '').trim(), challenge.destination, challenge.codeHash);
    const evaluation = evaluateOtp(
      { expiresAt: challenge.expiresAt, consumedAt: challenge.consumedAt, attempts: challenge.attempts, maxAttempts: challenge.maxAttempts },
      isMatch
    );

    if (evaluation.outcome !== 'OK') {
      if (evaluation.outcome === 'INVALID_CODE') await this.otpRepo.incrementAttempts(challenge.id);
      return { ok: false, code: evaluation.outcome, message: evaluation.message };
    }

    await this.otpRepo.markConsumed(challenge.id);
    return { ok: true, userId: challenge.userId, purpose: challenge.purpose, channel: challenge.channel, destination: challenge.destination };
  }
}

/** After an enrolment OTP is verified, turns on SMS/email 2FA and issues backup codes. */
export class EnableOtpTwoFactorUseCase {
  constructor(private readonly twoFactor: ITwoFactorRepository, private readonly hasher: IOtpHasher) {}

  async execute(input: { userId: string; method: 'sms' | 'email' }): Promise<{ backupCodes: string[] }> {
    const plaintext = generateBackupCodes();
    const entries: BackupCodeEntry[] = plaintext.map((code) => ({
      hash: this.hasher.hash(normalizeBackupCode(code), input.userId),
      usedAt: null,
    }));
    await this.twoFactor.enable(input.userId, input.method, entries);
    return { backupCodes: plaintext };
  }
}
