import { IAuthAttemptRepository, AuthOutcome } from '../../ports/IAuthAttemptRepository';
import {
  assessLoginRisk,
  evaluateLoginThrottle,
  DEFAULT_LOGIN_THROTTLE,
  RiskAssessment,
} from '../../../domain/security/RiskEngine';

const WINDOW_SECONDS = DEFAULT_LOGIN_THROTTLE.windowSeconds;

export interface LoginGate {
  locked: boolean;
  retryAfterSeconds: number;
  risk: RiskAssessment;
}

/**
 * Brute-force + risk guard around authentication. Call `assess` before
 * verifying the password (hard-lock check + risk signals) and `record`
 * after, so lockouts and fraud scores are driven by real recent history.
 */
export class LoginSecurityUseCase {
  constructor(private readonly attempts: IAuthAttemptRepository) {}

  async assess(input: { email: string; ipAddress: string | null }): Promise<LoginGate> {
    const since = new Date(Date.now() - WINDOW_SECONDS * 1000);
    const email = input.email.trim().toLowerCase();

    const [failuresForEmail, failuresForIp, knownDevice] = await Promise.all([
      this.attempts.countRecentFailures({ email, since }),
      input.ipAddress ? this.attempts.countRecentFailures({ ipAddress: input.ipAddress, since }) : Promise.resolve(0),
      email ? this.attempts.hasPriorSuccess(email) : Promise.resolve(false),
    ]);

    const throttle = evaluateLoginThrottle(failuresForEmail);
    const risk = assessLoginRisk({
      recentFailuresForEmail: failuresForEmail,
      recentFailuresForIp: failuresForIp,
      knownDevice,
      recentOtpFailures: 0,
    });

    return { locked: throttle.locked, retryAfterSeconds: throttle.retryAfterSeconds, risk };
  }

  async record(input: {
    email: string;
    userId: string | null;
    ipAddress: string | null;
    outcome: AuthOutcome;
    riskScore: number;
  }): Promise<void> {
    await this.attempts.record({
      email: input.email.trim().toLowerCase() || null,
      userId: input.userId,
      ipAddress: input.ipAddress,
      outcome: input.outcome,
      riskScore: input.riskScore,
    });
  }
}
