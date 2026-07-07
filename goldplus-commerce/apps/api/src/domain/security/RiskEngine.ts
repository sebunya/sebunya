/**
 * Risk / fraud scoring — pure decision logic.
 *
 * Turns observed signals (failed-login velocity, new device, OTP failures,
 * order velocity) into a 0–100 score and an action. The application layer
 * gathers the signals from real data and enforces the decision.
 */

export type RiskDecision = 'allow' | 'challenge' | 'deny';

export interface RiskAssessment {
  score: number; // 0–100
  decision: RiskDecision;
  reasons: string[];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function decide(score: number): RiskDecision {
  if (score >= 80) return 'deny';
  if (score >= 45) return 'challenge';
  return 'allow';
}

export interface LoginRiskSignals {
  /** Failed logins for this identity in the recent window. */
  recentFailuresForEmail: number;
  /** Failed logins from this IP in the recent window. */
  recentFailuresForIp: number;
  /** Whether this identity has ever successfully signed in before. */
  knownDevice: boolean;
  /** Recent wrong OTP/2FA attempts. */
  recentOtpFailures: number;
}

export function assessLoginRisk(signals: LoginRiskSignals): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  if (signals.recentFailuresForEmail > 0) {
    score += signals.recentFailuresForEmail * 12;
    reasons.push(`${signals.recentFailuresForEmail} recent failed sign-ins for this account`);
  }
  if (signals.recentFailuresForIp >= 10) {
    score += 30;
    reasons.push('High failed-login volume from this network');
  } else if (signals.recentFailuresForIp >= 5) {
    score += 15;
    reasons.push('Elevated failed-login volume from this network');
  }
  if (!signals.knownDevice) {
    score += 15;
    reasons.push('Sign-in from a new device or location');
  }
  if (signals.recentOtpFailures >= 3) {
    score += 25;
    reasons.push('Multiple incorrect verification codes');
  }

  return { score: clamp(score), decision: decide(clamp(score)), reasons };
}

export interface LoginThrottleRule {
  maxFailures: number;
  windowSeconds: number;
}

export const DEFAULT_LOGIN_THROTTLE: LoginThrottleRule = { maxFailures: 8, windowSeconds: 900 }; // 8 per 15 min

/**
 * Hard lockout independent of the soft risk score: once failures pass the
 * threshold in the window, authentication is refused outright. This is the
 * brute-force backstop.
 */
export function evaluateLoginThrottle(
  recentFailures: number,
  rule: LoginThrottleRule = DEFAULT_LOGIN_THROTTLE
): { locked: boolean; retryAfterSeconds: number } {
  const locked = recentFailures >= rule.maxFailures;
  return { locked, retryAfterSeconds: locked ? rule.windowSeconds : 0 };
}

export interface OrderRiskSignals {
  ordersLastHour: number;
  ordersLastDay: number;
  /** Distinct delivery phones used by this account/device recently. */
  distinctPhonesLastDay?: number;
}

export function assessOrderRisk(signals: OrderRiskSignals): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  // Blatant automation — deny outright regardless of other signals.
  if (signals.ordersLastHour >= 10) {
    return { score: 100, decision: 'deny', reasons: ['Automated-looking order volume in the last hour'] };
  }

  if (signals.ordersLastHour >= 5) {
    score += 45;
    reasons.push('Unusually high order rate in the last hour');
  } else if (signals.ordersLastHour >= 3) {
    score += 20;
    reasons.push('Elevated order rate in the last hour');
  }
  if (signals.ordersLastDay >= 15) {
    score += 30;
    reasons.push('Very high order count today');
  }
  if ((signals.distinctPhonesLastDay ?? 0) >= 4) {
    score += 25;
    reasons.push('Many different delivery numbers used');
  }

  return { score: clamp(score), decision: decide(clamp(score)), reasons };
}
