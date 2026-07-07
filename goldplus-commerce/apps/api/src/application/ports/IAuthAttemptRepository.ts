export type AuthOutcome = 'SUCCESS' | 'BAD_CREDENTIALS' | 'LOCKED' | 'TWO_FACTOR_REQUIRED' | 'TWO_FACTOR_FAILED';

export interface IAuthAttemptRepository {
  record(input: {
    email: string | null;
    userId: string | null;
    ipAddress: string | null;
    outcome: AuthOutcome;
    riskScore: number;
  }): Promise<void>;

  countRecentFailures(opts: { email?: string | null; ipAddress?: string | null; since: Date }): Promise<number>;

  /** Has this email ever signed in successfully (known account/device heuristic)? */
  hasPriorSuccess(email: string): Promise<boolean>;
}
